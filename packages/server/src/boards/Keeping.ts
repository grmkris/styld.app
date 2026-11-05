import {
  type BoardId,
  CurrentAccount,
  type KeepLook,
  type KeptLook,
  LookId,
  maximumBoardPins,
  NotFound,
  OperationConflict,
  OutfitRefused,
  PinRefused,
} from '@styld/protocol'
import { Effect, Option } from 'effect'
import { CaptureMetrics } from '../kernel/Metrics.ts'
import { Database, nowDate, stored } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { Looks } from '../looks/Looks.ts'
import { lookRows } from '../looks/Store.ts'
import { outfitKept } from '../outfits/Outfits.ts'
import { ownPieceIds } from '../wardrobe/Store.ts'
import { lookTarget, newPins, one, ownBoard, type BoardServices } from './Shared.ts'
import { type BoardOutfitRow, BoardStore } from './Store.ts'

// Keeping a look on a board (T-16): pieces the person put together on a board become a look in The Lab, pinned on the
// board it was made on. The look, its pin and the operation's receipt are one D1 batch, so a keep is never half done.

/** The look an operation kept, with its board as it is now. A repeat after the look was deleted is a conflict: the id
 * is spent, as for `createLook`. */
const answer = (accountId: string, boardId: BoardId, lookId: string) =>
  Effect.gen(function* () {
    const look = yield* (yield* Looks)
      .getLook(LookId.make(lookId))
      .pipe(Effect.catchTag('NotFound', () => Effect.fail(OperationConflict.make({}))))
    const board = yield* one(accountId, boardId)
    const kept: KeptLook = { look, board }
    return kept
  })

/** The template board's outfit (T-10) a keep names, if it names one: on this board and not kept yet, since its card
 * shows the one look it became. */
const keepable = Effect.fnUntraced(function* (boardId: string, outfitId: string | undefined) {
  if (outfitId === undefined) return Option.none<BoardOutfitRow>()
  const found = yield* stored((yield* BoardStore).findOutfit(boardId, outfitId))
  if (Option.isNone(found)) return yield* NotFound.make({})
  if (found.value.lookId !== null) return yield* OutfitRefused.make({ reason: 'kept', missing: [] })
  return found
})

export const keeping = Effect.map(Effect.context<BoardServices | CaptureMetrics>(), (context) => ({
  /** Keep the account's pieces as a look pinned on its board, once per operation id; counted for the outfit engine
   * when it proposed them. */
  keepLook: Effect.fn('Styld.Boards.keepLook')(function* (boardId: BoardId, input: KeepLook) {
    const { accountId } = yield* CurrentAccount
    const db = yield* Database
    const store = yield* BoardStore
    const { operationId, ...keep } = input
    const pieceIds = [...new Set(keep.pieceIds)]
    const write = Effect.gen(function* () {
      yield* ownBoard(accountId, boardId)
      const outfit = yield* keepable(boardId, keep.outfitId)
      const owned = yield* stored(ownPieceIds(db, accountId, pieceIds))
      if (pieceIds.some((id) => !owned.has(id))) return yield* NotFound.make({})
      const held = (yield* stored(store.pinCounts([boardId]))).get(boardId) ?? 0
      if (held + 1 > maximumBoardPins) return yield* PinRefused.make({ reason: 'boardFull' })
      const id = yield* newId('lk')
      const at = yield* nowDate
      const look = { id, accountId, name: keep.name, occasion: null, createdAt: at, sharedAt: null }
      const pins = yield* newPins(boardId, [lookTarget(id)], at)
      if (keep.proposal !== undefined) yield* outfitKept(yield* CaptureMetrics, keep.proposal, 'kept')
      const statements = [
        ...lookRows(db, look, pieceIds),
        ...pins.map(store.pinRow),
        store.updateBoard(accountId, boardId, { updatedAt: at }),
        ...Option.toArray(Option.map(outfit, ({ id: outfitId }) => store.outfitKept(boardId, outfitId, id))),
      ]
      return { statements, result: id }
    })
    return yield* store.recorded(
      {
        accountId,
        operationId,
        command: 'keepLook',
        input: [
          boardId,
          keep.name,
          pieceIds,
          keep.proposal ?? null,
          ...(keep.outfitId === undefined ? [] : [keep.outfitId]),
        ],
      },
      { write, answer: (lookId) => answer(accountId, boardId, lookId) },
    )
  }, Effect.provide(context)),
}))
