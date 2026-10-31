import {
  type AddWish,
  type Author,
  type CreateReport,
  Handle,
  NotWithYourself,
  PublicNotFound,
  type Relation,
  type PublicPiece,
  type ReportTarget,
  reportsPerHour,
  reportsToHide,
  type SaveTarget,
  type SavedThing,
  type SetBlocked,
  type SetFollowing,
  type SetSaved,
  TooManyReports,
  WardrobeUnavailable,
  Wish,
} from '@styld/protocol'
import { Context, DateTime, Duration, Effect, Match, Option, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { CheckTarget, Checks } from '../safety/Checks.ts'
import type { StoreUnavailable } from '../wardrobe/Store.ts'
import { feedFor } from './Feed.ts'
import { authorOf, type PublicPages, summaryOf } from './Public.ts'
import { makePublicStore } from './PublicStore.ts'
import { makeSocialStore, type SaveRow, type SocialStore, type WishRow } from './SocialStore.ts'

// What people do with each other: saving what others made public, following, blocking and reporting. Everything
// acts for `CurrentAccount`, sees others through the public pages' rules, and refuses one's own things.

const unavailable = () => WardrobeUnavailable.make({})
const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)
const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)
const orNotFound = <A>(found: Option.Option<A>) =>
  Option.match(found, { onNone: () => Effect.fail(PublicNotFound.make({})), onSome: Effect.succeed })

type Database = Parameters<typeof makeSocialStore>[0]

/** Whose a saveable or reportable thing is, read without regard to who may see it. */
const ownerOf = (database: Database) => {
  const store = makePublicStore(database)
  return {
    piece: (pieceId: string) =>
      Effect.map(stored(store.pieces([pieceId])), (rows) =>
        Option.map(Option.fromNullishOr(rows[0]), ({ piece }) => piece.accountId),
      ),
    look: (lookId: string) =>
      Effect.map(
        stored(store.look(lookId)),
        Option.map(({ accountId }) => accountId),
      ),
    board: (boardId: string) =>
      Effect.map(
        stored(store.board(boardId)),
        Option.map(({ accountId }) => accountId),
      ),
    profiles: (accountIds: ReadonlyArray<string>) =>
      Effect.forEach(accountIds, (accountId) => stored(store.profileOf(accountId))),
  }
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

/** What the social operations share. */
interface Parts {
  readonly database: Database
  readonly store: SocialStore
  readonly owners: ReturnType<typeof ownerOf>
  readonly pages: PublicPages['Service']
  readonly checks: Checks['Service']
  readonly newId: (prefix: 'sv' | 'rp' | 'ws') => Effect.Effect<string, WardrobeUnavailable>
}

/** Whose a saved thing is. */
const ownerOfSaved = (p: Parts, row: { readonly kind: SaveRow['kind']; readonly id: string }) =>
  row.kind === 'piece' ? p.owners.piece(row.id) : row.kind === 'look' ? p.owners.look(row.id) : p.owners.board(row.id)

/** A save's target in its own column. */
const columnsOf = (row: { readonly kind: SaveRow['kind']; readonly id: string }) => ({
  kind: row.kind,
  pieceId: row.kind === 'piece' ? row.id : null,
  lookId: row.kind === 'look' ? row.id : null,
  boardId: row.kind === 'board' ? row.id : null,
})

/** A saved thing as it is now, or none once its owner made it private, it failed its check, or a block came
 * between. */
const savedThing = (p: Parts, kind: SaveRow['kind'], id: string, viewer: string, savedAt: string) => {
  const shown =
    kind === 'piece'
      ? Effect.map(p.pages.piece(id, Option.some(viewer)), ({ piece, by }): SavedThing => ({
          _tag: 'SavedPiece',
          piece,
          by,
          savedAt,
        }))
      : kind === 'look'
        ? Effect.map(p.pages.look(id, Option.some(viewer)), ({ look, by }): SavedThing => ({
            _tag: 'SavedLook',
            look,
            by,
            savedAt,
          }))
        : Effect.map(p.pages.board(id, Option.some(viewer)), (board): SavedThing => ({
            _tag: 'SavedBoard',
            board: summaryOf(board),
            by: board.by,
            savedAt,
          }))
  return shown.pipe(
    Effect.catchTag('PublicNotFound', () => Effect.succeed(undefined)),
    Effect.map(Option.fromNullishOr),
  )
}

/** Someone by handle, while they are published and no block stands between them and the account. */
const someone = (p: Parts, viewer: string, handle: string) =>
  Effect.gen(function* () {
    const accountId = yield* Effect.flatMap(stored(p.store.accountOf(handle)), orNotFound)
    if (accountId === viewer) return yield* NotWithYourself.make({})
    if (yield* stored(p.store.hasBlocked(accountId, viewer))) return yield* PublicNotFound.make({})
    return accountId
  })
const relationOf = (p: Parts, viewer: string, handle: string, accountId: string) =>
  Effect.gen(function* () {
    const relation: Relation = {
      handle: yield* Schema.decodeUnknownEffect(Handle)(handle).pipe(Effect.orDie),
      following: yield* stored(p.store.isFollowing(viewer, accountId)),
      blocked: yield* stored(p.store.hasBlocked(viewer, accountId)),
    }
    return relation
  })
const authors = (p: Parts, accountIds: ReadonlyArray<string>) =>
  Effect.map(p.owners.profiles(accountIds), (rows) =>
    rows.flatMap((row) => (Option.isSome(row) ? Option.toArray(authorOf(row.value)) : [])),
  )

/** The reported thing's owner and its check, while the reporter can see it. */
const reported = (p: Parts, viewer: string, target: ReportTarget) =>
  Match.value(target).pipe(
    Match.tagsExhaustive({
      ReportedProfile: ({ handle }) =>
        Effect.gen(function* () {
          yield* p.pages.profile(handle, Option.some(viewer))
          const accountId = yield* Effect.flatMap(stored(p.store.accountOf(handle)), orNotFound)
          return { owner: accountId, check: { kind: 'profile', id: accountId } satisfies CheckTarget }
        }),
      ReportedBoard: ({ boardId }) =>
        Effect.gen(function* () {
          yield* p.pages.board(boardId, Option.some(viewer))
          const owner = yield* Effect.flatMap(p.owners.board(boardId), orNotFound)
          return { owner, check: { kind: 'board', id: boardId } satisfies CheckTarget }
        }),
      ReportedLook: ({ lookId }) =>
        Effect.gen(function* () {
          yield* p.pages.look(lookId, Option.some(viewer))
          const owner = yield* Effect.flatMap(p.owners.look(lookId), orNotFound)
          return { owner, check: { kind: 'look', id: lookId } satisfies CheckTarget }
        }),
      ReportedPiece: ({ pieceId }) =>
        Effect.gen(function* () {
          yield* p.pages.piece(pieceId, Option.some(viewer))
          const owner = yield* Effect.flatMap(p.owners.piece(pieceId), orNotFound)
          return { owner, check: { kind: 'piece', id: pieceId } satisfies CheckTarget }
        }),
    }),
  )

const saving = (p: Parts) => ({
  /** What the account saved from others, newest first, while each is still public to them. */
  listSaved: Effect.fn('Styld.Social.saved')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored(p.store.saves(accountId))
    const shown = yield* Effect.forEach(
      rows,
      (row) => savedThing(p, row.kind, savedId(row), accountId, row.createdAt.toISOString()),
      { concurrency: 8 },
    )
    return { saved: shown.flatMap(Option.toArray) }
  }),
  /** Save something someone else made public, or take the save back; one's own things are on one's boards. */
  setSaved: Effect.fn('Styld.Social.setSaved')(function* (input: SetSaved) {
    const { accountId } = yield* CurrentAccount
    const row = saveRowOf(input.target)
    if (!input.saved) {
      yield* stored(p.store.unsave(accountId, row.kind, row.id))
      return { saved: false }
    }
    const owner = yield* Effect.flatMap(ownerOfSaved(p, row), orNotFound)
    if (owner === accountId) return yield* NotWithYourself.make({})
    const at = yield* nowDate
    if (Option.isNone(yield* savedThing(p, row.kind, row.id, accountId, at.toISOString())))
      return yield* PublicNotFound.make({})
    yield* stored(p.store.save({ id: yield* p.newId('sv'), accountId, ...columnsOf(row), createdAt: at }))
    return { saved: true }
  }),
})

const relations = (p: Parts) => ({
  relation: Effect.fn('Styld.Social.relation')(function* (handle: string) {
    const { accountId } = yield* CurrentAccount
    return yield* relationOf(p, accountId, handle, yield* someone(p, accountId, handle))
  }),
  /** Follow someone, privately, or stop. */
  setFollowing: Effect.fn('Styld.Social.setFollowing')(function* (handle: string, input: SetFollowing) {
    const { accountId } = yield* CurrentAccount
    const other = yield* someone(p, accountId, handle)
    if (input.following) {
      if (yield* stored(p.store.hasBlocked(accountId, other))) return yield* PublicNotFound.make({})
      yield* stored(p.store.follow(accountId, other, yield* nowDate))
    } else yield* stored(p.store.unfollow(accountId, other))
    return yield* relationOf(p, accountId, handle, other)
  }),
  /** Block someone, which hides each from the other and ends follows both ways, or unblock them. They are never
   * told. */
  setBlocked: Effect.fn('Styld.Social.setBlocked')(function* (handle: string, input: SetBlocked) {
    const { accountId } = yield* CurrentAccount
    const other = yield* Effect.flatMap(stored(p.store.accountOf(handle)), orNotFound)
    if (other === accountId) return yield* NotWithYourself.make({})
    if (input.blocked) yield* stored(p.store.block(accountId, other, yield* nowDate))
    else yield* stored(p.store.unblock(accountId, other))
    return yield* relationOf(p, accountId, handle, other)
  }),
  following: Effect.fn('Styld.Social.following')(function* () {
    const { accountId } = yield* CurrentAccount
    const people: ReadonlyArray<Author> = yield* authors(p, yield* stored(p.store.followees(accountId)))
    return { people }
  }),
  blocked: Effect.fn('Styld.Social.blocked')(function* () {
    const { accountId } = yield* CurrentAccount
    const people: ReadonlyArray<Author> = yield* authors(p, yield* stored(p.store.blockedBy(accountId)))
    return { people }
  }),
  /** What people the account follows made public lately, from `cursor` back. */
  feed: Effect.fn('Styld.Social.feed')(function* (cursor: string | undefined) {
    const { accountId } = yield* CurrentAccount
    return yield* feedFor(
      { database: p.database, pages: p.pages, social: p.store, checks: p.checks },
      accountId,
      cursor,
    )
  }),
})

const reporting = (p: Parts) => ({
  /** Report something others can see. Styld's check looks at it again, and three people's reports hide it; a
   * profile only leaves discovery. Ten reports an hour at most. */
  report: Effect.fn('Styld.Social.report')(function* (input: CreateReport) {
    const { accountId } = yield* CurrentAccount
    const { owner, check } = yield* reported(p, accountId, input.target)
    if (owner === accountId) return yield* NotWithYourself.make({})
    const since = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, Duration.hours(1)))
    if ((yield* stored(p.store.reportsSince(accountId, since))) >= reportsPerHour) return yield* TooManyReports.make({})
    const reporters = yield* stored(
      p.store.report({
        id: yield* p.newId('rp'),
        reporterId: accountId,
        ownerId: owner,
        targetKind: check.kind,
        targetId: check.id,
        reason: input.reason,
        note: input.note ?? null,
        createdAt: yield* nowDate,
      }),
    )
    yield* p.checks.reported(check, reporters >= reportsToHide && check.kind !== 'profile')
  }),
})

/** A wish as the protocol shows it: the piece while it is still public to the person, else what it was. */
const wishOf = (p: Parts, row: WishRow, viewer: string) =>
  Effect.gen(function* () {
    const shown =
      row.sourcePieceId === null
        ? Option.none<{ readonly piece: PublicPiece; readonly by: Author }>()
        : yield* p.pages.piece(row.sourcePieceId, Option.some(viewer)).pipe(Effect.option)
    return yield* Schema.decodeUnknownEffect(Wish)({
      id: row.id,
      name: row.name,
      category: row.category,
      piece: Option.match(shown, { onNone: () => null, onSome: ({ piece }) => piece }),
      by: Option.match(shown, { onNone: () => null, onSome: ({ by }) => by }),
      createdAt: row.createdAt.toISOString(),
    }).pipe(Effect.orDie)
  })

const wishing = (p: Parts) => ({
  /** What the person wants one like, newest first. */
  listWishes: Effect.fn('Styld.Social.wishes')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored(p.store.wishes(accountId))
    return { wishes: yield* Effect.forEach(rows, (row) => wishOf(p, row, accountId), { concurrency: 8 }) }
  }),
  /** Want one like someone else's public piece; wishing for it again answers the first wish. */
  addWish: Effect.fn('Styld.Social.addWish')(function* (input: AddWish) {
    const { accountId } = yield* CurrentAccount
    const owner = yield* Effect.flatMap(p.owners.piece(input.pieceId), orNotFound)
    if (owner === accountId) return yield* NotWithYourself.make({})
    const { piece } = yield* p.pages.piece(input.pieceId, Option.some(accountId))
    const row = yield* stored(
      p.store.wish({
        id: yield* p.newId('ws'),
        accountId,
        sourcePieceId: piece.id,
        name: piece.name,
        category: piece.category,
        createdAt: yield* nowDate,
      }),
    )
    return yield* wishOf(p, row, accountId)
  }),
  removeWish: Effect.fn('Styld.Social.removeWish')(function* (wishId: string) {
    const { accountId } = yield* CurrentAccount
    yield* stored(p.store.unwish(accountId, wishId))
  }),
})

const make = (database: Database, pages: PublicPages['Service'], checks: Checks['Service']) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const p: Parts = {
      database,
      store: makeSocialStore(database),
      owners: ownerOf(database),
      pages,
      checks,
      newId: (prefix) =>
        Effect.map(crypto.randomBytes(16), (bytes) => `${prefix}_${Base64Url.encode(bytes)}`).pipe(
          Effect.mapError(unavailable),
        ),
    }
    return { ...saving(p), ...relations(p), ...reporting(p), ...wishing(p) }
  })

/** Saves, follows, blocks and reports. */
export class Social extends Context.Service<Social, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/Social',
) {}

/** The social service over the Worker's database, public pages and checks. Build it once per isolate. */
export const makeSocial = (database: Database, pages: PublicPages['Service'], checks: Checks['Service']) =>
  Effect.map(make(database, pages, checks), (service) => Social.of(service))
