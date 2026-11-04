import { boardImages, boardItems, boards, contentChecks, looks, pieces, profiles } from '@styld/db'
import { CheckReason, CheckState, type CheckStatus, Unavailable } from '@styld/protocol'
import { and, asc, eq, inArray, isNotNull, lt, ne, notExists, or, sql } from 'drizzle-orm'
import { Array, Context, DateTime, Duration, Effect, Layer, Option, Schema } from 'effect'
import type { Picture } from '../capture/Providers.ts'
import { collect } from '../Streams.ts'
import { deliverImage } from '../wardrobe/Delivery.ts'
import { reachedThrough } from '../social/PublicStore.ts'
import { profileOf } from '../social/ProfileStore.ts'
import { boardTranslationsIn, profileTranslationIn } from '../social/Translated.ts'
import { type Database as Db, Database, inChunks, nowDate, query } from '../kernel/Db.ts'
import { Media } from '../kernel/Media.ts'
import { type Content, ContentJudge, type Verdict, worse } from './Judge.ts'
import { digestOf } from '../kernel/Ids.ts'
import { heldBackOrigin, piecesWithPictures, publicImage } from '../social/Visibility.ts'

/** What a check is of: a profile (by account), a board, a look or a piece. */
export const CheckTarget = Schema.Struct({
  kind: Schema.Literals(['profile', 'board', 'look', 'piece']),
  id: Schema.String,
})
export type CheckTarget = typeof CheckTarget.Type

/** The queue's message: check this target again. */
export const CheckMessage = Schema.TaggedUnion({ CheckContent: { target: CheckTarget } })

/** The queue checks are sent to, as the Worker's binding takes them. */
export class CheckQueue extends Context.Service<
  CheckQueue,
  { sendBatch(messages: Iterable<{ readonly body: typeof CheckMessage.Type }>): Promise<unknown> }
>()('@styld/server/safety/CheckQueue') {
  static readonly layer = (queue: CheckQueue['Service']) => Layer.succeed(this, queue)
}

/** A queue takes at most this many messages a call. */
const queueBatch = 100

const unavailable = () => Unavailable.make({})
const read = <A>(run: () => Promise<A>) => query(run).pipe(Effect.mapError(unavailable))
type Drizzle = Db['Service']

/** What a target shows others: its words, where its pictures are kept (read only when judged), and whether its
 * owner has made it public, which is when it is judged. */
interface Shown {
  readonly accountId: string
  readonly texts: ReadonlyArray<string>
  readonly pictures: ReadonlyArray<{ readonly key: string; readonly contentType: string }>
  readonly public: boolean
}

const nothing = (texts: ReadonlyArray<string | null>) => texts.filter((text): text is string => text !== null)

/** A profile shows its name, handle, city and bio, and the translation of its name and bio that is shown with it. */
const profileShows = (db: Drizzle, accountId: string) =>
  Effect.gen(function* () {
    const row = yield* profileOf(db, accountId).pipe(Effect.mapError(unavailable))
    if (Option.isNone(row)) return Option.none<Shown>()
    const translated = yield* profileTranslationIn(db, 'sl', row.value).pipe(Effect.mapError(unavailable))
    return Option.some<Shown>({
      accountId,
      texts: nothing([
        row.value.name,
        row.value.handle,
        row.value.city,
        row.value.bio,
        translated?.name ?? null,
        translated?.bio ?? null,
      ]),
      pictures: [],
      public: row.value.published,
    })
  })

const boardShows = (db: Drizzle, boardId: string) =>
  Effect.gen(function* () {
    const row = Option.fromNullishOr(
      (yield* read(() => db.select().from(boards).where(eq(boards.id, boardId)).limit(1)))[0],
    )
    if (Option.isNone(row)) return Option.none<Shown>()
    if (row.value.visibility !== 'public')
      return Option.some<Shown>({ accountId: row.value.accountId, texts: [], pictures: [], public: false })
    const labels = yield* read(() =>
      db
        .select({ id: boardItems.id, text: boardItems.text })
        .from(boardItems)
        .where(and(eq(boardItems.boardId, boardId), isNotNull(boardItems.text))),
    )
    // Its translation is shown too, while it translates these words, so it is judged with them.
    const words = labels.flatMap(({ id, text }) => (text === null ? [] : [{ id, text }]))
    const translated = (yield* boardTranslationsIn(db, 'sl', [
      { id: boardId, name: row.value.name, labels: words },
    ]).pipe(Effect.mapError(unavailable))).get(boardId)
    const pictures = yield* read(() =>
      db
        .select({ key: boardImages.objectKey, contentType: boardImages.contentType })
        .from(boardImages)
        // An outfit photo is never shown to others, so it is never judged for them.
        .where(and(eq(boardImages.boardId, boardId), ne(boardImages.origin, heldBackOrigin))),
    )
    return Option.some<Shown>({
      accountId: row.value.accountId,
      texts: nothing([
        row.value.name,
        ...labels.map(({ text }) => text),
        translated?.name ?? null,
        ...Object.values(translated?.labels ?? {}),
      ]),
      pictures,
      public: true,
    })
  })

const lookShows = (db: Drizzle, lookId: string) =>
  Effect.map(
    read(() => db.select().from(looks).where(eq(looks.id, lookId)).limit(1)),
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
const pieceReachable = (db: Drizzle, piece: typeof pieces.$inferSelect) =>
  Effect.gen(function* () {
    if (piece.status !== 'ready') return false
    const owner = yield* profileOf(db, piece.accountId).pipe(Effect.mapError(unavailable))
    if (Option.isNone(owner) || !owner.value.published) return false
    return yield* reachedThrough(db, piece.accountId, piece.id, false).pipe(Effect.mapError(unavailable))
  })

/** A piece shows others its name and its public rendition: the cut-out or the clean drawing, never the photo it came
 * from. A piece with no rendition of its own is never shown to others, so nothing of it is judged. */
const pieceShows = (db: Drizzle, pieceId: string) =>
  Effect.gen(function* () {
    const [row] = yield* read(() => piecesWithPictures(db, eq(pieces.id, pieceId)).limit(1))
    if (row === undefined) return Option.none<Shown>()
    const image = publicImage(row)
    return Option.some<Shown>({
      accountId: row.piece.accountId,
      texts: nothing([row.piece.name]),
      pictures: Option.toArray(image),
      public: Option.isSome(image) && (yield* pieceReachable(db, row.piece)),
    })
  })

const shownBy = (db: Drizzle, target: CheckTarget) => {
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
const picturesOf = (media: Media['Service'], shown: Shown) =>
  Effect.forEach(shown.pictures, (stored) =>
    deliverImage(media, stored, 'thumb', { fallback: 'none' }).pipe(
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

/** The statement that forgets the account's check of a target, for the batch that deletes the target. */
export const forgetCheck = (db: Drizzle, accountId: string, target: CheckTarget) =>
  db.delete(contentChecks).where(and(targetIs(target), eq(contentChecks.accountId, accountId)))

/** The statement that forgets the account's checks of several targets of one kind (at most a chunk of ids, `chunked`),
 * for the batch that deletes them. */
export const forgetChecks = (db: Drizzle, accountId: string, kind: CheckTarget['kind'], ids: ReadonlyArray<string>) =>
  db
    .delete(contentChecks)
    .where(
      and(
        eq(contentChecks.targetKind, kind),
        inArray(contentChecks.targetId, [...ids]),
        eq(contentChecks.accountId, accountId),
      ),
    )

/** A check whose target is gone: the target's own table no longer has its row. */
const targetGone = (db: Drizzle) =>
  or(
    and(
      eq(contentChecks.targetKind, 'board'),
      notExists(db.select({ id: boards.id }).from(boards).where(eq(boards.id, contentChecks.targetId))),
    ),
    and(
      eq(contentChecks.targetKind, 'look'),
      notExists(db.select({ id: looks.id }).from(looks).where(eq(looks.id, contentChecks.targetId))),
    ),
    and(
      eq(contentChecks.targetKind, 'piece'),
      notExists(db.select({ id: pieces.id }).from(pieces).where(eq(pieces.id, contentChecks.targetId))),
    ),
    and(
      eq(contentChecks.targetKind, 'profile'),
      notExists(
        db.select({ id: profiles.accountId }).from(profiles).where(eq(profiles.accountId, contentChecks.targetId)),
      ),
    ),
  )

/** The rows the sweep reads and forgets. */
const sweepRows = (db: Drizzle) => ({
  /** Checks still pending since before `before`: their queue messages ran out, or never left. */
  stalePending: (before: Date, limit: number) =>
    read(() =>
      db
        .select({ kind: contentChecks.targetKind, id: contentChecks.targetId })
        .from(contentChecks)
        .where(and(eq(contentChecks.state, 'pending'), lt(contentChecks.requestedAt, before)))
        .orderBy(asc(contentChecks.requestedAt))
        .limit(limit),
    ),
  /** Forget the checks of targets deleted without them (a piece or a profile), a batch at a time; how many went. */
  forgetGone: (limit: number) =>
    Effect.map(
      read(() =>
        db
          .delete(contentChecks)
          .where(
            inArray(
              sql`rowid`,
              db
                .select({ row: sql`rowid` })
                .from(contentChecks)
                .where(targetGone(db))
                .limit(limit),
            ),
          )
          .returning({ id: contentChecks.targetId }),
      ),
      (gone) => gone.length,
    ),
  /** Stop pending work for a private target without erasing reports or an admin's hide. Clearing the digest forces
   * a fresh check on republishing; deleted targets are removed by forgetGone. */
  abandon: (target: CheckTarget) =>
    read(() =>
      db
        .update(contentChecks)
        .set({ state: 'unsure', digest: '', reason: null })
        .where(and(targetIs(target), eq(contentChecks.state, 'pending'))),
    ).pipe(Effect.asVoid),
})

/** The check rows: one per target, written only here.
 * @internal Exported for its tests. */
export const checkRows = (db: Drizzle) => ({
  ...sweepRows(db),
  /** Where the target's check stands, if it has been public. */
  kept: (target: CheckTarget) =>
    Effect.map(
      read(() => db.select().from(contentChecks).where(targetIs(target)).limit(1)),
      (rows) => Option.map(Option.fromNullishOr(rows[0]), statusOf),
    ),
  /** Mark the target pending under its new digest, unless it was checked with this digest already, which answers
   * that check. */
  pending: (target: CheckTarget, accountId: string, digest: string) =>
    Effect.gen(function* () {
      const at = yield* nowDate
      const known = (yield* read(() => db.select().from(contentChecks).where(targetIs(target)).limit(1)))[0]
      if (known !== undefined && known.digest === digest && known.state !== 'pending')
        return Option.some(statusOf(known))
      yield* read(() =>
        db
          .insert(contentChecks)
          .values({
            targetKind: target.kind,
            targetId: target.id,
            accountId,
            digest,
            state: 'pending',
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
    read(() =>
      db
        .update(contentChecks)
        .set({ state: verdict.state, reason: verdict.reason, model: verdict.model })
        .where(and(targetIs(target), eq(contentChecks.digest, digest))),
    ),
  /** Where the checks of these targets stand. */
  statuses: (kind: CheckTarget['kind'], ids: ReadonlyArray<string>) =>
    Effect.map(
      inChunks(ids, (chunk) =>
        db
          .select()
          .from(contentChecks)
          .where(and(eq(contentChecks.targetKind, kind), inArray(contentChecks.targetId, chunk))),
      ).pipe(Effect.mapError(unavailable)),
      (rows) => new Map(rows.map((row) => [row.targetId, statusOf(row)])),
    ),
  /** Hide the target from others whatever the model says, until an admin restores it. */
  hide: (target: CheckTarget, by: 'reports' | 'admin') =>
    read(() => db.update(contentChecks).set({ hidden: by }).where(targetIs(target))).pipe(Effect.asVoid),
  /** An admin's hide, or restore to what the check says; answers whether the target has a check to change. */
  curate: (target: CheckTarget, hidden: boolean) =>
    read(() =>
      db
        .update(contentChecks)
        .set({ hidden: hidden ? 'admin' : null })
        .where(targetIs(target))
        .returning({ id: contentChecks.targetId }),
    ).pipe(Effect.map((changed) => changed.length > 0)),
})

/** What a check judged: the words and pictures shown, as one digest. */
const shownDigest = (shown: Shown) => digestOf(JSON.stringify([shown.texts, shown.pictures]))

/** The schedule's sweep: checks pending for five minutes go to the queue again, so nothing stays hidden only because a
 * message was lost (the delivery abandons one whose target is gone or private), and the checks of targets deleted
 * without them are forgotten. */
const sweep = (
  rows: ReturnType<typeof checkRows>,
  enqueue: (targets: ReadonlyArray<CheckTarget>) => Effect.Effect<void, Unavailable>,
) =>
  Effect.fn('Styld.Checks.sweep')(function* () {
    const before = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, pendingPatience))
    const stale = yield* rows.stalePending(before, sweepBatch)
    yield* enqueue(stale.flatMap((row) => Option.toArray(Schema.decodeUnknownOption(CheckTarget)(row))))
    const forgotten = yield* rows.forgetGone(sweepBatch)
    return stale.length + forgotten
  })

const make = Effect.gen(function* () {
  const judge = yield* ContentJudge
  const db = yield* Database
  const media = yield* Media
  const queue = yield* CheckQueue
  const rows = checkRows(db)
  const enqueue = (targets: ReadonlyArray<CheckTarget>) =>
    Effect.forEach(
      Array.chunksOf(targets, queueBatch),
      (chunk) =>
        read(() => queue.sendBatch(chunk.map((target) => ({ body: { _tag: 'CheckContent' as const, target } })))),
      { discard: true },
    )
  /** The model's verdict on everything the target shows: the words with its first pictures, then the rest a few at a
   * time, the worst answer standing. None while the model does not answer for any of them. */
  const verdictOn = (shown: Shown) =>
    Effect.gen(function* () {
      const pictures = yield* picturesOf(media, shown)
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
    /** Check the target as it is now, if its owner has made it public; a private one keeps the check it had. A model
     * that does not answer leaves it pending: `queue` sends it to the queue to try again, `fail` fails, for the
     * queue's own delivery to be retried. */
    checkNow: Effect.fn('Styld.Checks.checkNow')(function* (
      target: CheckTarget,
      unanswered: 'queue' | 'fail' = 'queue',
    ) {
      const shown = yield* shownBy(db, target)
      if (Option.isNone(shown) || !shown.value.public) {
        yield* rows.abandon(target)
        return yield* rows.kept(target)
      }
      const digest = yield* shownDigest(shown.value)
      const known = yield* rows.pending(target, shown.value.accountId, digest)
      if (Option.isSome(known)) return known
      if (!(yield* judged(target, shown.value, digest))) {
        if (unanswered === 'fail') return yield* unavailable()
        yield* enqueue([target])
      }
      return yield* rows.kept(target)
    }),
    status: Effect.fn('Styld.Checks.status')(function* (target: CheckTarget) {
      return yield* rows.kept(target)
    }),
    statuses: Effect.fn('Styld.Checks.statuses')(function* (kind: CheckTarget['kind'], ids: ReadonlyArray<string>) {
      return yield* rows.statuses(kind, ids)
    }),
    /** An admin hides the target from everyone but its owner, or restores it to what its check says. */
    curate: Effect.fn('Styld.Checks.curate')(function* (target: CheckTarget, hidden: boolean) {
      return yield* rows.curate(target, hidden)
    }),
    sweep: sweep(rows, enqueue),
    /** Check these later, through the queue: a wardrobe can hold hundreds of pieces. The queue skips what is private
     * by then, and what was checked as it is. */
    checkLater: Effect.fn('Styld.Checks.checkLater')(function* (targets: ReadonlyArray<CheckTarget>) {
      yield* enqueue(targets)
    }),
    /** Something public changed: it is pending from now, and checked through the queue. A private one waits until it
     * is made public. Answers whether it is public. */
    changed: Effect.fn('Styld.Checks.changed')(function* (target: CheckTarget) {
      const shown = yield* shownBy(db, target)
      if (Option.isNone(shown) || !shown.value.public) return false
      const known = yield* rows.pending(target, shown.value.accountId, yield* shownDigest(shown.value))
      if (Option.isNone(known)) yield* enqueue([target])
      return true
    }),
    /** A report: the target is hidden once enough people reported it, and the model looks at it again; its earlier
     * verdict stands until the new one lands, and stays if the model does not answer. */
    reported: Effect.fn('Styld.Checks.reported')(function* (target: CheckTarget, hide: boolean) {
      if (hide) yield* rows.hide(target, 'reports')
      const shown = yield* shownBy(db, target)
      if (Option.isNone(shown) || !shown.value.public) return
      const digest = yield* shownDigest(shown.value)
      const verdict = yield* verdictOn(shown.value)
      // A new verdict replaces the one it had, without a pending state in between; content changed meanwhile keeps its
      // pending check of the new content.
      if (Option.isSome(verdict)) yield* rows.answered(target, digest, verdict.value)
    }),
  }
})

/** The model's checks of what people make public, over the application's database, media and check queue. */
export class Checks extends Context.Service<Checks, Effect.Success<typeof make>>()('@styld/server/safety/Checks') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Checks.of(service)),
  )
}
