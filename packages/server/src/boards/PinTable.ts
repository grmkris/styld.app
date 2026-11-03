import {
  BoardItemId,
  BoardVersionConflict,
  CurrentAccount,
  type BoardId,
  type LookId,
  maximumBoardItems,
  maximumBoardPins,
  PieceItem,
  PiecePin,
  LookPin,
  type PieceId,
  PinRefused,
  landing,
} from '@styld/protocol'
import { Effect, Option, Predicate, Schema } from 'effect'
import { Database, nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { receiptRow, type Identified } from '../kernel/Receipts.ts'
import { Looks } from '../looks/Looks.ts'
import { ownPieceIds } from '../wardrobe/Store.ts'
import { itemRow, lookTarget, newPins, one, pieceTarget, priorOf, stored, unavailable } from './Shared.ts'
import { BoardStore } from './Store.ts'

/** Add the requested pieces and a look's pieces without moving anything already laid out. Pins, placements,
 * version and operation receipt commit together; a racing editor makes this reread before trying again. */
export const placePins = Effect.fn('Styld.Boards.placePins')(function* (
  boardId: BoardId,
  pieceIds: ReadonlyArray<PieceId>,
  lookIds: ReadonlyArray<LookId>,
  operation: Identified,
) {
  const { accountId } = yield* CurrentAccount
  const looks = yield* (yield* Looks).looksById(lookIds)
  const targets = [...new Set([...pieceIds, ...looks.flatMap((look) => look.pieces.map((piece) => piece.id))])]
  const owned = yield* stored(ownPieceIds(yield* Database, accountId, targets))
  if (targets.some((id) => !owned.has(id))) return yield* PinRefused.make({ reason: 'pieceNotFound' })
  const attempt = Effect.gen(function* () {
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    const board = yield* one(accountId, boardId)
    const onTable = new Set(board.items.filter(Schema.is(PieceItem)).map((item) => item.pieceId))
    const missing = targets.filter((id) => !onTable.has(id))
    const pinned = new Set(board.pins.flatMap((pin) => (Schema.is(PiecePin)(pin) ? [pin.piece.id] : [])))
    const pinnedLooks = new Set(board.pins.flatMap((pin) => (Schema.is(LookPin)(pin) ? [pin.look.id] : [])))
    const additions = [
      ...targets.filter((id) => !pinned.has(id)).map(pieceTarget),
      ...lookIds.filter((id) => !pinnedLooks.has(id)).map(lookTarget),
    ]
    if (
      board.items.length + missing.length > maximumBoardItems ||
      board.pins.length + additions.length > maximumBoardPins
    )
      return yield* PinRefused.make({ reason: 'boardFull' })
    const ids = yield* Effect.forEach(missing, () =>
      Effect.flatMap(newId('bi'), Schema.decodeUnknownEffect(BoardItemId)).pipe(Effect.orDie),
    )
    const items = missing.reduce((table, pieceId, index) => {
      const id = ids[index]
      return id === undefined ? table : [...table, PieceItem.make({ id, pieceId, ...landing(table, 380) })]
    }, board.items)
    const at = yield* nowDate
    const counted = yield* (yield* BoardStore)
      .saveItems({
        accountId,
        boardId,
        version: board.version,
        items: items.map(itemRow),
        pins: yield* newPins(boardId, additions, at),
        receipt: yield* receiptRow(operation, boardId),
        at,
      })
      .pipe(Effect.orElseSucceed(() => Option.none()))
    if (Option.isSome(counted) || Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    const latest = yield* one(accountId, boardId)
    return yield* latest.version === board.version
      ? unavailable()
      : BoardVersionConflict.make({ version: latest.version })
  })
  return yield* attempt.pipe(
    Effect.retry({ while: (error) => Predicate.isTagged(error, 'BoardVersionConflict'), times: 2 }),
    Effect.catchTag('BoardVersionConflict', () => Effect.fail(unavailable())),
  )
})
