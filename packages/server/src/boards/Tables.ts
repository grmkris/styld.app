import {
  type ArrangeBoard,
  arranged,
  type BoardId,
  type BoardItem,
  BoardItemId,
  BoardItemRefused,
  BoardVersionConflict,
  CurrentAccount,
  ImageItem,
  landed,
  maximumBoardItems,
  PieceItem,
  type PlacedThing,
  type SaveBoardItems,
  type SetTable,
  settle,
  TextItem,
} from '@styld/protocol'
import { Array, Effect, Match, Option, Predicate, Schema } from 'effect'
import { ownPieceIds } from '../wardrobe/Store.ts'
import { itemRow, newPins, one, ownBoard, pieceTarget, priorOf, stored, unavailable } from './Shared.ts'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, receiptRow, type Identified } from '../kernel/Receipts.ts'
import { BoardStore } from './Store.ts'
import { Database } from '../kernel/Db.ts'
import type { BoardServices } from './Shared.ts'

// Saving a board's table: the editor's whole table, an assistant's arrangement, an assistant's exact table.

/** Why a table cannot be saved, if it cannot: two items with one id, a piece that is neither the account's nor
 * pinned on the board, or a picture that is not on this board. */
const tableRefusal = (accountId: string, boardId: string, items: ReadonlyArray<BoardItem>) =>
  Effect.gen(function* () {
    if (new Set(items.map(({ id }) => id)).size !== items.length) return Option.some('duplicateId' as const)
    const pieceIds = [...new Set(items.filter(Schema.is(PieceItem)).map(({ pieceId }) => pieceId))]
    const owned = yield* stored(ownPieceIds(yield* Database, accountId, pieceIds))
    const others = pieceIds.filter((id) => !owned.has(id))
    const pinned =
      others.length === 0 ? new Set<string>() : yield* stored((yield* BoardStore).piecesPinned(boardId, others))
    if (others.some((id) => !pinned.has(id))) return Option.some('pieceNotFound' as const)
    const imageIds = [...new Set(items.filter(Schema.is(ImageItem)).map(({ imageId }) => imageId))]
    const onBoard = yield* stored((yield* BoardStore).imagesOn(boardId, imageIds))
    if (imageIds.some((id) => !onBoard.has(id))) return Option.some('imageNotFound' as const)
    return Option.none()
  })

/** A save that did not land: the board changed or went since it was read, or D1 failed. */
const lostSave = (accountId: string, boardId: string, version: number) =>
  Effect.gen(function* () {
    const board = yield* ownBoard(accountId, boardId)
    return yield* board.version === version ? unavailable() : BoardVersionConflict.make({ version: board.version })
  })

/** Save a table from a version under an operation, pinning the pieces it places; a board saved since answers its
 * current version, and the same operation that committed meanwhile answers the board as it is. */
const savedTable = (
  accountId: string,
  boardId: string,
  table: { readonly version: number; readonly items: ReadonlyArray<BoardItem> },
  operation: Identified,
) =>
  Effect.gen(function* () {
    const refusal = yield* tableRefusal(accountId, boardId, table.items)
    if (Option.isSome(refusal)) return yield* BoardItemRefused.make({ reason: refusal.value })
    const placed = [...new Set(table.items.filter(Schema.is(PieceItem)).map(({ pieceId }) => pieceId))]
    const pinned = yield* stored((yield* BoardStore).piecesPinned(boardId, placed))
    const at = yield* nowDate
    const save = {
      accountId,
      boardId,
      version: table.version,
      items: table.items.map(itemRow),
      pins: yield* newPins(boardId, placed.filter((id) => !pinned.has(id)).map(pieceTarget), at),
      receipt: yield* receiptRow(operation, boardId),
      at,
    }
    const counted = yield* (yield* BoardStore).saveItems(save).pipe(Effect.orElseSucceed(() => Option.none()))
    if (Option.isSome(counted)) return yield* one(accountId, boardId)
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    return yield* lostSave(accountId, boardId, table.version)
  })

/** Fresh ids for things an assistant puts on the table. */
const itemIds = (count: number) =>
  Effect.forEach(
    Array.makeBy(count, () => undefined),
    () => Effect.flatMap(newId('bi'), (id) => Schema.decodeUnknownEffect(BoardItemId)(id).pipe(Effect.orDie)),
  )

/** What a placed thing becomes on the table, with its id and its place in the stack. */
const placedItem = (placed: PlacedThing, id: BoardItemId): BoardItem => {
  const at = {
    id,
    x: placed.x,
    y: placed.y,
    size: placed.size,
    turn: placed.turn ?? 0,
    z: 0,
    flipped: placed.flipped ?? false,
  }
  return Match.value(placed.thing).pipe(
    Match.tagsExhaustive({
      TablePiece: ({ pieceId }) => PieceItem.make({ ...at, pieceId }),
      TablePicture: ({ imageId }) => ImageItem.make({ ...at, imageId }),
      TableLabel: ({ text, style }) => TextItem.make({ ...at, text, style }),
    }),
  )
}

/** How many times an assistant's arrangement reads the board again when an editor saved first. */
const arrangeAttempts = 2

export const tables = Effect.map(Effect.context<BoardServices>(), (context) => ({
  /** Replace the board's table with the editor's, from the version the editor loaded, pinning the pieces it
   * places; a board saved since answers its current version instead. The same operation id answers the
   * board as it is now. */
  saveBoardItems: Effect.fn('Styld.Boards.saveItems')(function* (boardId: BoardId, input: SaveBoardItems) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'saveBoardItems',
      input: [boardId, input.version, input.items],
    })
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    const board = yield* ownBoard(accountId, boardId)
    if (board.version !== input.version) return yield* BoardVersionConflict.make({ version: board.version })
    return yield* savedTable(accountId, boardId, input, operation)
  }, Effect.provide(context)),
  /** An assistant's change to the table: things added where they land, then the whole table laid out. It reads
   * the board as it is now, and once more if an editor saved in between. */
  arrangeBoard: Effect.fn('Styld.Boards.arrange')(function* (boardId: BoardId, input: ArrangeBoard) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'arrangeBoard',
      input: [boardId, input.layout, input.add ?? []],
    })
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    const adding = input.add ?? []
    const ids = yield* itemIds(adding.length)
    const attempt = Effect.gen(function* () {
      const board = yield* one(accountId, boardId)
      const items = Array.reduce(Array.zip(adding, ids), board.items, (table, [thing, id]) => [
        ...table,
        landed(table, thing, id),
      ])
      if (items.length > maximumBoardItems) return yield* BoardItemRefused.make({ reason: 'tableFull' })
      return yield* savedTable(
        accountId,
        boardId,
        { version: board.version, items: arranged(items, input.layout) },
        operation,
      )
    })
    return yield* attempt.pipe(
      Effect.retry({
        while: (error) => Predicate.isTagged(error, 'BoardVersionConflict'),
        times: arrangeAttempts - 1,
      }),
    )
  }, Effect.provide(context)),
  /** An assistant's exact table: every thing where it says, in its order, replacing what was saved, from the
   * version it read. */
  setTable: Effect.fn('Styld.Boards.setTable')(function* (boardId: BoardId, input: SetTable) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'setTable',
      input: [boardId, input.version, input.items],
    })
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    const board = yield* ownBoard(accountId, boardId)
    if (board.version !== input.version) return yield* BoardVersionConflict.make({ version: board.version })
    const ids = yield* itemIds(input.items.length)
    const items = Array.zipWith(input.items, ids, (placed, id) => placedItem(placed, id)).map((item, index) =>
      settle({ ...item, z: index + 1 }),
    )
    return yield* savedTable(accountId, boardId, { version: input.version, items }, operation)
  }, Effect.provide(context)),
}))
