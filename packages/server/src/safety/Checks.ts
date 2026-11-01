import { boardImages, boardItems, boards, contentChecks, looks, pieces, piecePictures, profiles } from '@styld/db'
import { CheckReason, CheckState, type CheckStatus, Unavailable } from '@styld/protocol'
import { and, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Array, Context, DateTime, Duration, Effect, Option, Schema } from 'effect'
import type { Picture } from '../capture/Providers.ts'
import { collect } from '../Streams.ts'
import { deliverImage, type ImageBindings } from '../wardrobe/Delivery.ts'
import { reachedThrough } from '../social/PublicStore.ts'
import { shownImage } from '../wardrobe/Shown.ts'
import { chunked, nowDate } from '../kernel/Db.ts'
import { type Content, ContentJudge, type Verdict, worse } from './Judge.ts'
import { digestOf } from '../kernel/Ids.ts'
import { heldBackOrigin } from '../social/Visibility.ts'

/** What a check is of: a profile (by account), a board, a look or a piece. */
export const CheckTarget = Schema.Struct({
  kind: Schema.Literals(['profile', 'board', 'look', 'piece']),
  id: Schema.String,
})
export type CheckTarget = typeof CheckTarget.Type

/** The queue's message: check this target again. */
export const CheckMessage = Schema.TaggedUnion({ CheckContent: { target: CheckTarget } })

export interface CheckBindings extends ImageBindings {
  readonly database: Parameters<typeof drizzle>[0]
  readonly queue: {
    sendBatch(messages: Iterable<{ readonly body: typeof CheckMessage.Type }>): Promise<unknown>
  }
}

/** A queue takes at most this many messages a call. */
const queueBatch = 100

const unavailable = () => Unavailable.make({})
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: unavailable })
type Database = ReturnType<typeof drizzle>

/** What a target shows others: its words, where its pictures are kept (read only when judged), and whether its
 * owner has made it public, which is when it is judged. */
interface Shown {
  readonly accountId: string
  readonly texts: ReadonlyArray<string>
  readonly pictures: ReadonlyArray<{ readonly key: string; readonly contentType: string }>
  readonly public: boolean
}

const nothing = (texts: ReadonlyArray<string | null>) => texts.filter((text): text is string => text !== null)

const profileShows = (db: Database, accountId: string) =>
  Effect.map(
    attempt(() => db.select().from(profiles).where(eq(profiles.accountId, accountId)).limit(1)),
    (rows) =>
      Option.map(Option.fromNullishOr(rows[0]), (row): Shown => ({
        accountId,
        texts: nothing([row.name, row.handle, row.city, row.bio]),
        pictures: [],
        public: row.published,
      })),
  )

const boardShows = (db: Database, boardId: string) =>
  Effect.gen(function* () {
    const row = Option.fromNullishOr(
      (yield* attempt(() => db.select().from(boards).where(eq(boards.id, boardId)).limit(1)))[0],
    )
    if (Option.isNone(row)) return Option.none<Shown>()
    if (row.value.visibility !== 'public')
      return Option.some<Shown>({ accountId: row.value.accountId, texts: [], pictures: [], public: false })
    const labels = yield* attempt(() =>
      db
        .select({ text: boardItems.text })
        .from(boardItems)
        .where(and(eq(boardItems.boardId, boardId), isNotNull(boardItems.text))),
    )
    const pictures = yield* attempt(() =>
      db
        .select({ key: boardImages.objectKey, contentType: boardImages.contentType })
        .from(boardImages)
        // An outfit photo is never shown to others, so it is never judged for them.
        .where(and(eq(boardImages.boardId, boardId), ne(boardImages.origin, heldBackOrigin))),
    )
    return Option.some<Shown>({
      accountId: row.value.accountId,
      texts: nothing([row.value.name, ...labels.map(({ text }) => text)]),
      pictures,
      public: row.value.visibility === 'public',
    })
  })

const lookShows = (db: Database, lookId: string) =>
  Effect.map(
    attempt(() => db.select().from(looks).where(eq(looks.id, lookId)).limit(1)),
    (rows) =>
      Option.map(Option.fromNullishOr(rows[0]), (row): Shown => ({
        accountId: row.accountId,
        texts: nothing([row.name, row.occasion]),
        pictures: [],
        public: row.sharedAt !== null,
      })),
  )

/** Whether others can reach a ready piece through its owner's published profile: a public board it is pinned on, or
 * a shared look. Someone else's board never makes it public, and neither does publishing the profile. */
const pieceReachable = (db: Database, piece: typeof pieces.$inferSelect) =>
  Effect.gen(function* () {
    if (piece.status !== 'ready') return false
    const owner = (yield* attempt(() =>
      db.select().from(profiles).where(eq(profiles.accountId, piece.accountId)).limit(1),
    ))[0]
    if (owner === undefined || !owner.published) return false
    return yield* reachedThrough(db, piece.accountId, piece.id, false).pipe(Effect.mapError(unavailable))
  })

const pieceShows = (db: Database, pieceId: string) =>
  Effect.gen(function* () {
    const found = yield* attempt(() =>
      db
        .select({ piece: pieces, picture: piecePictures })
        .from(pieces)
        .leftJoin(piecePictures, eq(piecePictures.pieceId, pieces.id))
        .where(eq(pieces.id, pieceId))
        .limit(1),
    )
    const row = found[0]
    if (row === undefined) return Option.none<Shown>()
    return Option.some<Shown>({
      accountId: row.piece.accountId,
      texts: nothing([row.piece.name]),
      pictures: [shownImage(row.piece, row.picture ?? undefined)],
      public: yield* pieceReachable(db, row.piece),
    })
  })

const shownBy = (db: Database, target: CheckTarget) => {
  if (target.kind === 'profile') return profileShows(db, target.id)
  if (target.kind === 'board') return boardShows(db, target.id)
  if (target.kind === 'look') return lookShows(db, target.id)
  return pieceShows(db, target.id)
}

/** A check pending this long lost its message. */
const pendingPatience = Duration.minutes(5)
const sweepBatch = 100

/** The judge reads a few pictures at a time. */
const picturesPerJudgement = 3

/** The pictures' bytes as the judge reads them: small WebP copies, every one of them. */
const picturesOf = (bindings: ImageBindings, shown: Shown) =>
  Effect.forEach(shown.pictures, (stored) =>
    deliverImage(bindings, stored, 'thumb', { fallback: 'none' }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none<Picture>()),
          onSome: ({ body, contentType }) =>
            Effect.map(
              Effect.tryPromise({ try: () => collect(body), catch: unavailable }),
              (bytes): Option.Option<Picture> =>
                contentType === 'image/webp' || contentType === 'image/png' || contentType === 'image/jpeg'
                  ? Option.some({ bytes, contentType })
                  : Option.none(),
            ),
        }),
      ),
    ),
  ).pipe(Effect.map((found) => found.flatMap(Option.toArray)))

const statusOf = (row: typeof contentChecks.$inferSelect): CheckStatus => ({
  // Only this service writes the rows, through the protocol's literals; a row that does not decode is a bug.
  state: Schema.decodeUnknownSync(CheckState)(row.state),
  reason: Option.getOrNull(Schema.decodeUnknownOption(CheckReason)(row.reason)),
  hidden: row.hidden !== null,
})

const targetIs = (target: CheckTarget) =>
  and(eq(contentChecks.targetKind, target.kind), eq(contentChecks.targetId, target.id))

/** The check rows: one per target, written only here. */
const checkRows = (db: Database) => ({
  /** Checks still pending since before `before`: their queue messages ran out, or never left. */
  stalePending: (before: Date, limit: number) =>
    attempt(() =>
      db
        .select({ kind: contentChecks.targetKind, id: contentChecks.targetId })
        .from(contentChecks)
        .where(and(eq(contentChecks.state, 'pending'), lt(contentChecks.requestedAt, before)))
        .limit(limit),
    ),
  /** Where the target's check stands, if it has been public. */
  kept: (target: CheckTarget) =>
    Effect.map(
      attempt(() => db.select().from(contentChecks).where(targetIs(target)).limit(1)),
      (rows) => Option.map(Option.fromNullishOr(rows[0]), statusOf),
    ),
  /** Mark the target pending under its new digest, unless it was checked with this digest already, which answers
   * that check. */
  pending: (target: CheckTarget, accountId: string, digest: string) =>
    Effect.gen(function* () {
      const at = yield* nowDate
      const known = (yield* attempt(() => db.select().from(contentChecks).where(targetIs(target)).limit(1)))[0]
      if (known !== undefined && known.digest === digest && known.state !== 'pending')
        return Option.some(statusOf(known))
      yield* attempt(() =>
        db
          .insert(contentChecks)
          .values({
            targetKind: target.kind,
            targetId: target.id,
            accountId,
            digest,
            state: 'pending',
            attempts: 0,
            requestedAt: at,
          })
          .onConflictDoUpdate({
            target: [contentChecks.targetKind, contentChecks.targetId],
            set: { digest, state: 'pending', reason: null, requestedAt: at },
          }),
      )
      return Option.none<CheckStatus>()
    }),
  /** Record the model's answer, only on the digest it read: content changed meanwhile is checked again. */
  answered: (target: CheckTarget, digest: string, verdict: Verdict) =>
    Effect.flatMap(nowDate, (at) =>
      attempt(() =>
        db
          .update(contentChecks)
          .set({ state: verdict.state, reason: verdict.reason, model: verdict.model, checkedAt: at })
          .where(and(targetIs(target), eq(contentChecks.digest, digest))),
      ),
    ),
  /** Where the checks of these targets stand. */
  statuses: (kind: CheckTarget['kind'], ids: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(chunked(ids), (chunk) =>
        attempt(() =>
          db
            .select()
            .from(contentChecks)
            .where(and(eq(contentChecks.targetKind, kind), inArray(contentChecks.targetId, chunk))),
        ),
      ),
      (rows) => new Map(Array.flatten(rows).map((row) => [row.targetId, statusOf(row)])),
    ),
  /** Hide the target from others whatever the model says, until an admin restores it. */
  hide: (target: CheckTarget, by: 'reports' | 'admin') =>
    attempt(() => db.update(contentChecks).set({ hidden: by }).where(targetIs(target))).pipe(Effect.asVoid),
  /** An admin's hide, or restore to what the check says; answers whether the target has a check to change. */
  curate: (target: CheckTarget, hidden: boolean) =>
    attempt(() =>
      db
        .update(contentChecks)
        .set({ hidden: hidden ? 'admin' : null })
        .where(targetIs(target))
        .returning({ id: contentChecks.targetId }),
    ).pipe(Effect.map((changed) => changed.length > 0)),
})

/** What a check judged: the words and pictures shown, as one digest. */
const shownDigest = (shown: Shown) => digestOf(JSON.stringify([shown.texts, shown.pictures]))

const make = (bindings: CheckBindings) =>
  Effect.gen(function* () {
    const judge = yield* ContentJudge
    const db = drizzle(bindings.database)
    const rows = checkRows(db)
    const enqueue = (targets: ReadonlyArray<CheckTarget>) =>
      Effect.forEach(
        Array.chunksOf(targets, queueBatch),
        (chunk) =>
          attempt(() =>
            bindings.queue.sendBatch(chunk.map((target) => ({ body: { _tag: 'CheckContent' as const, target } }))),
          ),
        { discard: true },
      )
    /** The model's verdict on everything the target shows: the words with its first pictures, then the rest a few
     * at a time, the worst answer standing. None while the model does not answer for any of them. */
    const verdictOn = (shown: Shown) =>
      Effect.gen(function* () {
        const pictures = yield* picturesOf(bindings, shown)
        const groups = pictures.length === 0 ? [[]] : Array.chunksOf(pictures, picturesPerJudgement)
        const verdicts = yield* Effect.forEach(groups, (group, index) =>
          judge.judge({ texts: index === 0 ? shown.texts : [], pictures: group } satisfies Content),
        )
        return verdicts.reduce(worse)
      }).pipe(Effect.option)
    /** The model's verdict on what the target shows, recorded; none while the model does not answer. */
    const judged = (target: CheckTarget, shown: Shown, digest: string) =>
      Effect.gen(function* () {
        const verdict = yield* verdictOn(shown)
        if (Option.isSome(verdict)) yield* rows.answered(target, digest, verdict.value)
        return Option.isSome(verdict)
      })

    return {
      /** Check the target as it is now, if its owner has made it public; a private one keeps the check it had. A
       * model that does not answer leaves it pending: `queue` sends it to the queue to try again, `fail` fails,
       * for the queue's own delivery to be retried. */
      checkNow: Effect.fn('Styld.Checks.checkNow')(function* (
        target: CheckTarget,
        unanswered: 'queue' | 'fail' = 'queue',
      ) {
        const shown = yield* shownBy(db, target)
        if (Option.isNone(shown) || !shown.value.public) return yield* rows.kept(target)
        const digest = yield* shownDigest(shown.value)
        const known = yield* rows.pending(target, shown.value.accountId, digest)
        if (Option.isSome(known)) return known
        if (!(yield* judged(target, shown.value, digest))) {
          if (unanswered === 'fail') return yield* unavailable()
          yield* enqueue([target])
        }
        return yield* rows.kept(target)
      }),
      status: rows.kept,
      statuses: rows.statuses,
      /** An admin hides the target from everyone but its owner, or restores it to what its check says. */
      curate: rows.curate,
      /** The schedule's sweep: checks pending for five minutes go to the queue again, so nothing stays hidden only
       * because a message was lost. */
      sweep: Effect.fn('Styld.Checks.sweep')(function* () {
        const before = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, pendingPatience))
        const stale = yield* rows.stalePending(before, sweepBatch)
        yield* enqueue(stale.flatMap((row) => Option.toArray(Schema.decodeUnknownOption(CheckTarget)(row))))
        return stale.length
      }),
      /** Check these later, through the queue: a wardrobe can hold hundreds of pieces. The queue skips what is
       * private by then, and what was checked as it is. */
      checkLater: enqueue,
      /** Something public changed: it is pending from now, and checked through the queue. A private one waits
       * until it is made public. Answers whether it is public. */
      changed: Effect.fn('Styld.Checks.changed')(function* (target: CheckTarget) {
        const shown = yield* shownBy(db, target)
        if (Option.isNone(shown) || !shown.value.public) return false
        const known = yield* rows.pending(target, shown.value.accountId, yield* shownDigest(shown.value))
        if (Option.isNone(known)) yield* enqueue([target])
        return true
      }),
      /** A report: the target is hidden once enough people reported it, and the model looks at it again; its
       * earlier verdict stands until the new one lands, and stays if the model does not answer. */
      reported: Effect.fn('Styld.Checks.reported')(function* (target: CheckTarget, hide: boolean) {
        if (hide) yield* rows.hide(target, 'reports')
        const shown = yield* shownBy(db, target)
        if (Option.isNone(shown) || !shown.value.public) return
        const digest = yield* shownDigest(shown.value)
        const verdict = yield* verdictOn(shown.value)
        // A new verdict replaces the one it had, without a pending state in between; content changed meanwhile keeps
        // its pending check of the new content.
        if (Option.isSome(verdict)) yield* rows.answered(target, digest, verdict.value)
      }),
    }
  })

/** The model's checks of what people make public. */
export class Checks extends Context.Service<Checks, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/Checks',
) {}

/** Checks over the Worker's bindings, with the Worker's judge. Build it once per isolate. */
export const makeChecks = (bindings: CheckBindings) => Effect.map(make(bindings), (service) => Checks.of(service))
