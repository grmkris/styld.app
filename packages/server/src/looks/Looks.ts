import {
  type CreateLook,
  CurrentAccount,
  Look,
  type LookId,
  NotFound,
  OperationConflict,
  type OperationId,
  type ShareLook,
  Unavailable,
} from '@styld/protocol'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { Checks } from '../safety/Checks.ts'
import { requirePublished } from '../social/ProfileStore.ts'
import { toPiece } from '../wardrobe/Parts.ts'
import { ownPieceIds } from '../wardrobe/Store.ts'
import { Database, nowDate, type StoreUnavailable } from '../kernel/Db.ts'
import { type LookRow, type LookStore, lookStore } from './Store.ts'
import { newId } from '../kernel/Ids.ts'
import { deleting, identify, priorResult, receiptRow } from '../kernel/Receipts.ts'

const unavailable = () => Unavailable.make({})
const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)

/** What the look operations work through. */
interface Deps {
  readonly db: Database['Service']
  readonly checks: Checks['Service']
  readonly store: LookStore
}

/** Looks as their owner sees them, each with the pieces still in the wardrobe and its check, if it has been shared. */
const shown = Effect.fnUntraced(function* ({ checks, store }: Deps, rows: ReadonlyArray<LookRow>) {
  const ids = rows.map(({ id }) => id)
  const statuses = yield* checks.statuses('look', ids)
  const found = yield* stored(store.piecesOf(ids))
  return yield* Effect.forEach(rows, (row) =>
    Effect.gen(function* () {
      const lookPieces = yield* Effect.forEach(
        found.filter(({ lookId }) => lookId === row.id),
        ({ piece }) => toPiece(piece),
      )
      // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
      return yield* Schema.decodeUnknownEffect(Look)({
        id: row.id,
        name: row.name,
        occasion: row.occasion,
        pieces: lookPieces,
        shared: row.sharedAt !== null,
        check: statuses.get(row.id) ?? null,
        createdAt: row.createdAt.toISOString(),
      }).pipe(Effect.orDie)
    }),
  )
})

const one = Effect.fnUntraced(function* (deps: Deps, accountId: string, lookId: string) {
  const row = yield* stored(deps.store.findLook(accountId, lookId))
  if (Option.isNone(row)) return yield* NotFound.make({})
  const [look] = yield* shown(deps, [row.value])
  return look ?? (yield* NotFound.make({}))
})

const making = (deps: Deps) => ({
  /** Put a look together from the account's own pieces. The same operation id answers the same look; using it for
   * another look is a conflict. */
  createLook: Effect.fn('Styld.Looks.create')(function* (input: CreateLook) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'createLook',
      input: [input.name, input.occasion ?? null, input.pieceIds],
    })
    const prior = yield* priorResult(operation, yield* stored(deps.store.findReceipt(accountId, input.operationId)))
    // A repeat of an operation whose look was deleted since: the id is spent, a new look needs a new one.
    if (Option.isSome(prior))
      return yield* one(deps, accountId, prior.value).pipe(
        Effect.catchTag('NotFound', () => Effect.fail(OperationConflict.make({}))),
      )
    const pieceIds = [...new Set(input.pieceIds)]
    const owned = yield* stored(ownPieceIds(deps.db, accountId, pieceIds))
    if (pieceIds.some((id) => !owned.has(id))) return yield* NotFound.make({})
    const id = yield* newId('lk')
    const at = yield* nowDate
    yield* stored(
      deps.store.createLook(
        { id, accountId, name: input.name, occasion: input.occasion ?? null, createdAt: at, sharedAt: null },
        pieceIds,
        yield* receiptRow(operation, id),
      ),
    )
    return yield* one(deps, accountId, id)
  }),
  /** Delete the look and its check; its pins on boards go with it. A repeat of the same delete answers done. */
  deleteLook: Effect.fn('Styld.Looks.delete')(function* (lookId: LookId, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    yield* deleting(deps.store, { accountId, operationId, command: 'deleteLook', target: lookId }, (receipt) =>
      Effect.flatMap(stored(deps.store.deleteLook(accountId, lookId, receipt)), (deleted) =>
        deleted ? Effect.void : Effect.fail(NotFound.make({})),
      ),
    )
  }),
})

const reading = (deps: Deps) => ({
  listLooks: Effect.fn('Styld.Looks.list')(function* () {
    const { accountId } = yield* CurrentAccount
    return yield* shown(deps, yield* stored(deps.store.listLooks(accountId)))
  }),
  getLook: Effect.fn('Styld.Looks.get')(function* (lookId: LookId) {
    const { accountId } = yield* CurrentAccount
    return yield* one(deps, accountId, lookId)
  }),
  /** These looks as their owner sees them, whoever's they are: the looks pinned on a board. */
  looksById: Effect.fn('Styld.Looks.byId')(function* (lookIds: ReadonlyArray<string>) {
    if (lookIds.length === 0) return []
    return yield* shown(deps, yield* stored(deps.store.looksById(lookIds)))
  }),
})

const sharing = (deps: Deps) => ({
  /** Share the look on the profile, which needs a published profile, or stop sharing it. A shared look is checked as
   * it is now, and its pieces through the queue. */
  shareLook: Effect.fn('Styld.Looks.share')(function* (lookId: LookId, input: ShareLook) {
    const { accountId } = yield* CurrentAccount
    const row = yield* stored(deps.store.findLook(accountId, lookId))
    if (Option.isNone(row)) return yield* NotFound.make({})
    if (!input.shared) {
      yield* stored(deps.store.setShared(accountId, lookId, null))
      return yield* one(deps, accountId, lookId)
    }
    yield* requirePublished(deps.db, accountId)
    yield* stored(deps.store.setShared(accountId, lookId, row.value.sharedAt ?? (yield* nowDate)))
    yield* deps.checks.checkNow({ kind: 'look', id: lookId })
    const pieceIds = (yield* stored(deps.store.piecesOf([lookId]))).map(({ piece }) => piece.id)
    yield* deps.checks.checkLater(pieceIds.map((id) => ({ kind: 'piece' as const, id })))
    return yield* one(deps, accountId, lookId)
  }),
})

const make = Effect.gen(function* () {
  const db = yield* Database
  const deps: Deps = { db, checks: yield* Checks, store: lookStore(db) }
  return { ...making(deps), ...reading(deps), ...sharing(deps) }
})

/** Looks, for the website and for assistants. Every operation acts for `CurrentAccount`, which HTTP and MCP provide per
 * request, so no operation takes whose looks they are from its input. */
export class Looks extends Context.Service<Looks, Effect.Success<typeof make>>()('@styld/server/looks/Looks') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Looks.of(service)),
  )
}
