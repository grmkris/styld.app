import { once, recorded } from '../kernel/Receipts.ts'
import {
  Author,
  type CreateReport,
  CurrentAccount,
  Handle,
  LimitReached,
  NotFound,
  NotWithYourself,
  type Relation,
  reportsPerHour,
  reportsToHide,
  type ReportTarget,
  type SavedThing,
  type SaveTarget,
  type SetBlocked,
  type SetFollowing,
  type SetSaved,
  Unavailable,
} from '@styld/protocol'
import { Context, DateTime, Duration, Effect, Layer, Match, Option, Schema } from 'effect'
import { type CheckTarget, Checks } from '../safety/Checks.ts'
import { Database, nowDate, type StoreUnavailable } from '../kernel/Db.ts'
import { feedFor } from './Feed.ts'
import { handleOwner, profileOf } from './ProfileStore.ts'
import { authorOf, PublicPages, summaryOf } from './Public.ts'
import { PublicStore } from './PublicStore.ts'
import { type SaveRow, SocialStore } from './SocialStore.ts'
import { newId } from '../kernel/Ids.ts'

// What people do with each other: saving what others made public, following, blocking and reporting. Everything
// acts for `CurrentAccount`, sees others through the public pages' rules, and refuses one's own things.

const unavailable = () => Unavailable.make({})
const stored = <A, R>(effect: Effect.Effect<A, StoreUnavailable, R>) => Effect.mapError(effect, unavailable)
const orNotFound = <A>(found: Option.Option<A>) =>
  Option.match(found, { onNone: () => Effect.fail(NotFound.make({})), onSome: Effect.succeed })

/** Whose a saveable or reportable thing is, read without regard to who may see it. */
const owners = {
  piece: (pieceId: string) =>
    Effect.map(stored(Effect.flatMap(PublicStore, (store) => store.pieces([pieceId]))), (rows) =>
      Option.map(Option.fromNullishOr(rows[0]), ({ piece }) => piece.accountId),
    ),
  look: (lookId: string) =>
    Effect.map(
      stored(Effect.flatMap(PublicStore, (store) => store.look(lookId))),
      Option.map(({ accountId }) => accountId),
    ),
  board: (boardId: string) =>
    Effect.map(
      stored(Effect.flatMap(PublicStore, (store) => store.board(boardId))),
      Option.map(({ accountId }) => accountId),
    ),
  profiles: (accountIds: ReadonlyArray<string>) =>
    Effect.flatMap(Database, (db) => Effect.forEach(accountIds, (accountId) => stored(profileOf(db, accountId)))),
}

/** A save's target as the protocol names it, and its column values. */
const saveRowOf = (target: SaveTarget) =>
  Match.value(target).pipe(
    Match.tagsExhaustive({
      SavedPiece: ({ pieceId }) => ({ kind: 'piece' as const, id: pieceId }),
      SavedLook: ({ lookId }) => ({ kind: 'look' as const, id: lookId }),
      SavedBoard: ({ boardId }) => ({ kind: 'board' as const, id: boardId }),
    }),
  )

/** The row's target id, whichever column holds it. */
const savedId = (row: SaveRow) => row.pieceId ?? row.lookId ?? row.boardId ?? ''

/** The services the social operations work through, provided once by the `Social` layer. */
type SocialServices = Database | SocialStore | PublicStore | PublicPages | Checks

/** Whose a saved thing is. */
const ownerOfSaved = (row: { readonly kind: SaveRow['kind']; readonly id: string }) =>
  row.kind === 'piece' ? owners.piece(row.id) : row.kind === 'look' ? owners.look(row.id) : owners.board(row.id)

/** A save's target in its own column. */
const columnsOf = (row: { readonly kind: SaveRow['kind']; readonly id: string }) => ({
  kind: row.kind,
  pieceId: row.kind === 'piece' ? row.id : null,
  lookId: row.kind === 'look' ? row.id : null,
  boardId: row.kind === 'board' ? row.id : null,
})

/** A saved thing as it is now, or none once its owner made it private, it failed its check, or a block came
 * between. */
const savedThing = (kind: SaveRow['kind'], id: string, viewer: string, savedAt: string) =>
  Effect.flatMap(PublicPages, (pages) => {
    const shown =
      kind === 'piece'
        ? Effect.map(pages.piece(id, Option.some(viewer)), ({ piece, by }): SavedThing => ({
            _tag: 'SavedPiece',
            piece,
            by,
            savedAt,
          }))
        : kind === 'look'
          ? Effect.map(pages.look(id, Option.some(viewer)), ({ look, by }): SavedThing => ({
              _tag: 'SavedLook',
              look,
              by,
              savedAt,
            }))
          : Effect.map(pages.board(id, Option.some(viewer)), (board): SavedThing => ({
              _tag: 'SavedBoard',
              board: summaryOf(board),
              by: board.by,
              savedAt,
            }))
    return shown.pipe(
      Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
      Effect.map(Option.fromNullishOr),
    )
  })

/** Someone by handle, while they are published and no block stands between them and the account. */
const someone = (viewer: string, handle: string) =>
  Effect.gen(function* () {
    const accountId = yield* Effect.flatMap(stored(handleOwner(yield* Database, handle, 'published')), orNotFound)
    if (accountId === viewer) return yield* NotWithYourself.make({})
    if (yield* stored((yield* SocialStore).hasBlocked(accountId, viewer))) return yield* NotFound.make({})
    return accountId
  })
const relationOf = (viewer: string, handle: string, accountId: string) =>
  Effect.gen(function* () {
    const relation: Relation = {
      handle: yield* Schema.decodeUnknownEffect(Handle)(handle).pipe(Effect.orDie),
      following: yield* stored((yield* SocialStore).isFollowing(viewer, accountId)),
      blocked: yield* stored((yield* SocialStore).hasBlocked(viewer, accountId)),
    }
    return relation
  })
const authors = (accountIds: ReadonlyArray<string>) =>
  Effect.map(owners.profiles(accountIds), (rows) =>
    rows.flatMap((row) => (Option.isSome(row) ? Option.toArray(authorOf(row.value)) : [])),
  )

/** The reported thing's owner and its check, while the reporter can see it. */
const reported = (viewer: string, target: ReportTarget) =>
  Match.value(target).pipe(
    Match.tagsExhaustive({
      ReportedProfile: ({ handle }) =>
        Effect.gen(function* () {
          yield* (yield* PublicPages).profile(handle, Option.some(viewer))
          const accountId = yield* Effect.flatMap(stored(handleOwner(yield* Database, handle, 'published')), orNotFound)
          return { owner: accountId, check: { kind: 'profile', id: accountId } satisfies CheckTarget }
        }),
      ReportedBoard: ({ boardId }) =>
        Effect.gen(function* () {
          yield* (yield* PublicPages).board(boardId, Option.some(viewer))
          const owner = yield* Effect.flatMap(owners.board(boardId), orNotFound)
          return { owner, check: { kind: 'board', id: boardId } satisfies CheckTarget }
        }),
      ReportedLook: ({ lookId }) =>
        Effect.gen(function* () {
          yield* (yield* PublicPages).look(lookId, Option.some(viewer))
          const owner = yield* Effect.flatMap(owners.look(lookId), orNotFound)
          return { owner, check: { kind: 'look', id: lookId } satisfies CheckTarget }
        }),
      ReportedPiece: ({ pieceId }) =>
        Effect.gen(function* () {
          yield* (yield* PublicPages).piece(pieceId, Option.some(viewer))
          const owner = yield* Effect.flatMap(owners.piece(pieceId), orNotFound)
          return { owner, check: { kind: 'piece', id: pieceId } satisfies CheckTarget }
        }),
    }),
  )

const saving = Effect.map(Effect.context<SocialServices>(), (context) => ({
  /** What the account saved from others, newest first, while each is still public to them. */
  listSaved: Effect.fn('Styld.Social.saved')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored((yield* SocialStore).saves(accountId))
    const shown = yield* Effect.forEach(
      rows,
      (row) => savedThing(row.kind, savedId(row), accountId, row.createdAt.toISOString()),
      { concurrency: 8 },
    )
    return { saved: shown.flatMap(Option.toArray) }
  }, Effect.provide(context)),
  /** Save something someone else made public, or take the save back; one's own things are on one's boards. */
  setSaved: Effect.fn('Styld.Social.setSaved')(function* (input: SetSaved) {
    const { accountId } = yield* CurrentAccount
    const { operationId, ...change } = input
    const store = yield* SocialStore
    const row = saveRowOf(change.target)
    const write = Effect.gen(function* () {
      if (!change.saved) return { statements: [store.unsave(accountId, row.kind, row.id)], result: 'unsaved' }
      const owner = yield* Effect.flatMap(ownerOfSaved(row), orNotFound)
      if (owner === accountId) return yield* NotWithYourself.make({})
      const at = yield* nowDate
      if (Option.isNone(yield* savedThing(row.kind, row.id, accountId, at.toISOString())))
        return yield* NotFound.make({})
      const saved = store.save({ id: yield* newId('sv'), accountId, ...columnsOf(row), createdAt: at })
      return { statements: [saved], result: 'saved' }
    })
    return yield* recorded(
      yield* Database,
      { accountId, operationId, command: 'setSaved', input: change },
      { write, answer: (result) => Effect.succeed({ saved: result === 'saved' }) },
    )
  }, Effect.provide(context)),
}))

const relations = Effect.map(Effect.context<SocialServices>(), (context) => ({
  relation: Effect.fn('Styld.Social.relation')(function* (handle: string) {
    const { accountId } = yield* CurrentAccount
    return yield* relationOf(accountId, handle, yield* someone(accountId, handle))
  }, Effect.provide(context)),
  /** Follow someone, privately, or stop. */
  setFollowing: Effect.fn('Styld.Social.setFollowing')(function* (handle: string, input: SetFollowing) {
    const { accountId } = yield* CurrentAccount
    const store = yield* SocialStore
    const other = yield* someone(accountId, handle)
    const write = Effect.gen(function* () {
      if (!input.following) return { statements: [store.unfollow(accountId, other)], result: other }
      if (yield* stored(store.hasBlocked(accountId, other))) return yield* NotFound.make({})
      return { statements: [store.follow(accountId, other, yield* nowDate)], result: other }
    })
    return yield* recorded(
      yield* Database,
      { accountId, operationId: input.operationId, command: 'setFollowing', input: [handle, input.following] },
      { write, answer: () => relationOf(accountId, handle, other) },
    )
  }, Effect.provide(context)),
  /** Block someone, which hides each from the other and ends follows both ways, or unblock them. They are never
   * told. */
  setBlocked: Effect.fn('Styld.Social.setBlocked')(function* (handle: string, input: SetBlocked) {
    const { accountId } = yield* CurrentAccount
    const store = yield* SocialStore
    const db = yield* Database
    const other = yield* Effect.flatMap(stored(handleOwner(db, handle)), orNotFound)
    if (other === accountId) return yield* NotWithYourself.make({})
    const write = Effect.map(nowDate, (at) => ({
      statements: input.blocked ? store.block(accountId, other, at) : [store.unblock(accountId, other)],
      result: other,
    }))
    return yield* recorded(
      db,
      { accountId, operationId: input.operationId, command: 'setBlocked', input: [handle, input.blocked] },
      { write, answer: () => relationOf(accountId, handle, other) },
    )
  }, Effect.provide(context)),
  following: Effect.fn('Styld.Social.following')(function* () {
    const { accountId } = yield* CurrentAccount
    const people: ReadonlyArray<Author> = yield* authors(yield* stored((yield* SocialStore).followees(accountId)))
    return { people }
  }, Effect.provide(context)),
  /** Who the account blocked, by their handle and name even once they stopped publishing, so they can be unblocked. */
  blocked: Effect.fn('Styld.Social.blocked')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* owners.profiles(yield* stored((yield* SocialStore).blockedBy(accountId)))
    const people: ReadonlyArray<Author> = rows.flatMap((row) =>
      Option.isSome(row)
        ? Option.toArray(
            Schema.decodeUnknownOption(Author)({
              handle: row.value.handle,
              name: row.value.name,
              tone: row.value.tone,
            }),
          )
        : [],
    )
    return { people }
  }, Effect.provide(context)),
  /** What people the account follows made public lately, from `cursor` back. */
  feed: Effect.fn('Styld.Social.feed')(function* (cursor: string | undefined) {
    const { accountId } = yield* CurrentAccount
    return yield* feedFor(accountId, cursor)
  }, Effect.provide(context)),
}))

const reporting = Effect.map(Effect.context<SocialServices>(), (context) => ({
  /** Report something others can see. Styld's check looks at it again, and three people's reports hide it; a
   * profile only leaves discovery. Ten reports an hour at most. */
  report: Effect.fn('Styld.Social.report')(function* (input: CreateReport) {
    const { accountId } = yield* CurrentAccount
    const { operationId, ...report } = input
    yield* once(
      yield* SocialStore,
      { accountId, operationId, command: 'report', input: report },
      {
        replay: () => Effect.void,
        run: Effect.as(filedReport(accountId, report), [undefined, 'reported'] as const),
      },
    )
  }, Effect.provide(context)),
}))

/** File the report, unless it is the account's own thing or past the hour's count. */
const filedReport = (accountId: string, input: Omit<CreateReport, 'operationId'>) =>
  Effect.gen(function* () {
    const { owner, check } = yield* reported(accountId, input.target)
    if (owner === accountId) return yield* NotWithYourself.make({})
    const since = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, Duration.hours(1)))
    if ((yield* stored((yield* SocialStore).reportsSince(accountId, since))) >= reportsPerHour)
      return yield* LimitReached.make({ limit: 'reports' })
    const { filed, reporters } = yield* stored(
      (yield* SocialStore).report({
        id: yield* newId('rp'),
        reporterId: accountId,
        ownerId: owner,
        targetKind: check.kind,
        targetId: check.id,
        reason: input.reason,
        note: input.note ?? null,
        createdAt: yield* nowDate,
      }),
    )
    // The same person reporting the same thing again changes nothing, and asks the model nothing.
    if (!filed) return
    yield* (yield* Checks).reported(check, reporters >= reportsToHide && check.kind !== 'profile')
  })

/** Every social operation, each group built over the services it yields (`SocialServices`). */
const make = Effect.gen(function* () {
  return { ...(yield* saving), ...(yield* relations), ...(yield* reporting) }
})

/** Saves, follows, blocks and reports. */
export class Social extends Context.Service<Social, Effect.Success<typeof make>>()('@styld/server/social/Social') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Social.of(service)),
  ).pipe(Layer.provide([SocialStore.layer, PublicStore.layer]))
}
