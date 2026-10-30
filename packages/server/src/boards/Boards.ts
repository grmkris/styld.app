import {
  type AddBoardImage,
  type AddPins,
  Board,
  type BoardId,
  type BoardImage,
  type BoardItem,
  BoardImageId,
  BoardItemRefused,
  BoardNotFound,
  BoardSummary,
  BoardVersionConflict,
  type CreateBoard,
  ImageItem,
  type Look,
  maximumBoardPins,
  OperationConflict,
  PieceItem,
  PinRefused,
  type RemovePins,
  type SaveBoardItems,
  type UpdateBoard,
  UploadRefused,
  WardrobeUnavailable,
} from '@styld/protocol'
import { Array, Context, DateTime, Effect, Match, Option, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { CurrentAccount } from '../CurrentAccount.ts'
import { shownLooks } from '../looks/Looks.ts'
import { type LookStore, makeLookStore } from '../looks/Store.ts'
import { deliverImage, type ImageBindings } from '../wardrobe/Delivery.ts'
import type { ShownImage } from '../wardrobe/Http.ts'
import type { ImageSize } from '../wardrobe/Media.ts'
import { makeStore, type Store, type StoreUnavailable } from '../wardrobe/Store.ts'
import { toPiece, usableUpload, type WardrobeBindings } from '../wardrobe/Wardrobe.ts'
import {
  type BoardItemRow,
  type BoardPinRow,
  type BoardRow,
  type BoardStore,
  makeBoardStore,
  type PinRemoval,
} from './Store.ts'

/** The bindings boards keep their rows and pictures in. */
export interface BoardBindings extends ImageBindings {
  readonly database: WardrobeBindings['database']
}

const unavailable = () => WardrobeUnavailable.make({})
const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)
const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)

/** R2 deletes at most this many keys per call. */
const deleteBatch = 1000

/** How many of its newest pins a board in a list shows. */
const coverPins = 4

/** A stored item as the protocol shows it. */
const shownItem = (row: BoardItemRow) => {
  const placement = { id: row.id, x: row.x, y: row.y, size: row.size, turn: row.turn, z: row.z, flipped: row.flipped }
  return Match.value(row.kind).pipe(
    Match.when('piece', () => ({ _tag: 'PieceItem', ...placement, pieceId: row.pieceId })),
    Match.when('text', () => ({ _tag: 'TextItem', ...placement, text: row.text, style: row.textStyle })),
    Match.when('image', () => ({ _tag: 'ImageItem', ...placement, imageId: row.imageId })),
    Match.exhaustive,
  )
}

/** An item as a row: its kind and the one column that kind uses. */
const itemRow = (item: BoardItem): Omit<BoardItemRow, 'boardId'> => {
  const row = {
    id: item.id,
    x: item.x,
    y: item.y,
    size: item.size,
    turn: item.turn,
    z: item.z,
    flipped: item.flipped,
    pieceId: null,
    imageId: null,
    text: null,
    textStyle: null,
  }
  return Match.value(item).pipe(
    Match.tagsExhaustive({
      PieceItem: ({ pieceId }) => ({ ...row, kind: 'piece' as const, pieceId }),
      TextItem: ({ text, style }) => ({ ...row, kind: 'text' as const, text, textStyle: style }),
      ImageItem: ({ imageId }) => ({ ...row, kind: 'image' as const, imageId }),
    }),
  )
}

interface Parts {
  readonly bindings: BoardBindings
  readonly store: BoardStore
  readonly wardrobeStore: Store
  readonly lookStore: LookStore
  readonly newId: (prefix: 'bd' | 'bm' | 'pn') => Effect.Effect<string, WardrobeUnavailable>
  readonly digest: (text: string) => Effect.Effect<string, WardrobeUnavailable>
}

type PinWithPiece = Effect.Success<ReturnType<BoardStore['pinsOf']>>[number]

/** The looks these pins hold, by id. */
const pinnedLooks = (parts: Parts, pins: ReadonlyArray<PinWithPiece>) =>
  Effect.gen(function* () {
    const lookIds = [...new Set(pins.flatMap(({ pin }) => (pin.lookId === null ? [] : [pin.lookId])))]
    if (lookIds.length === 0) return new Map<string, Look>()
    const looks = yield* shownLooks(parts.lookStore, yield* stored(parts.lookStore.looksById(lookIds)))
    return new Map(looks.map((look) => [look.id, look]))
  })

/** A stored pin as the protocol shows it, to be decoded with its board; a pin whose piece, look or picture is
 * gone shows nothing. */
const shownPin = (row: PinWithPiece, looks: ReadonlyMap<string, Look>) =>
  Effect.gen(function* () {
    const base = { id: row.pin.id, addedAt: row.pin.createdAt.toISOString() }
    const look = row.pin.lookId === null ? undefined : looks.get(row.pin.lookId)
    const shownRow: ReadonlyArray<object> =
      row.pin.kind === 'piece' && row.piece !== null
        ? [{ _tag: 'PiecePin', ...base, piece: yield* toPiece(row.piece) }]
        : row.pin.kind === 'picture' && row.pin.imageId !== null
          ? [{ _tag: 'PicturePin', ...base, imageId: row.pin.imageId }]
          : row.pin.kind === 'look' && look !== undefined
            ? [{ _tag: 'LookPin', ...base, look }]
            : []
    return shownRow
  })

const shownPins = (parts: Parts, pins: ReadonlyArray<PinWithPiece>) =>
  Effect.gen(function* () {
    const looks = yield* pinnedLooks(parts, pins)
    const shownRows = yield* Effect.forEach(pins, (row) =>
      Effect.map(shownPin(row, looks), (shownRow) => ({ boardId: row.pin.boardId, pins: shownRow })),
    )
    return (boardId: string) => shownRows.filter((row) => row.boardId === boardId).flatMap((row) => row.pins)
  })

/** Boards as the protocol shows them, each with its table and pins. */
const shown = (parts: Parts, rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const ids = rows.map(({ id }) => id)
    const items = yield* stored(parts.store.itemsOf(ids))
    const pinsOf = yield* shownPins(parts, yield* stored(parts.store.pinsOf(ids)))
    return yield* Effect.forEach(rows, (row) =>
      // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
      Schema.decodeUnknownEffect(Board)({
        id: row.id,
        name: row.name,
        paper: row.paper,
        version: row.version,
        items: items.filter(({ boardId }) => boardId === row.id).map(shownItem),
        pins: pinsOf(row.id),
        updatedAt: row.updatedAt.toISOString(),
      }).pipe(Effect.orDie),
    )
  })

/** Boards in a list: each with its table, its newest pins and how many it holds. */
const summaries = (parts: Parts, rows: ReadonlyArray<BoardRow>) =>
  Effect.gen(function* () {
    const ids = rows.map(({ id }) => id)
    const items = yield* stored(parts.store.itemsOf(ids))
    const coverOf = yield* shownPins(parts, yield* stored(parts.store.coversOf(ids, coverPins)))
    const counts = yield* stored(parts.store.pinCounts(ids))
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(BoardSummary)({
        id: row.id,
        name: row.name,
        paper: row.paper,
        items: items.filter(({ boardId }) => boardId === row.id).map(shownItem),
        cover: coverOf(row.id),
        pinCount: counts.get(row.id) ?? 0,
        updatedAt: row.updatedAt.toISOString(),
      }).pipe(Effect.orDie),
    )
  })

const ownBoard = (parts: Parts, accountId: string, boardId: string) =>
  Effect.flatMap(stored(parts.store.findBoard(accountId, boardId)), (row) =>
    Option.match(row, { onNone: () => Effect.fail(BoardNotFound.make({})), onSome: Effect.succeed }),
  )

const one = (parts: Parts, accountId: string, boardId: string) =>
  Effect.gen(function* () {
    const [board] = yield* shown(parts, [yield* ownBoard(parts, accountId, boardId)])
    return board ?? (yield* BoardNotFound.make({}))
  })

const reads = (parts: Parts) => ({
  /** The account's boards, the most recently changed first. */
  listBoards: Effect.fn('Styld.Boards.list')(function* () {
    const { accountId } = yield* CurrentAccount
    return yield* summaries(parts, yield* stored(parts.store.listBoards(accountId)))
  }),
  getBoard: Effect.fn('Styld.Boards.get')(function* (boardId: BoardId) {
    const { accountId } = yield* CurrentAccount
    return yield* one(parts, accountId, boardId)
  }),
})

/** What an operation id already did, if anything: its result for the same command and input; anything else
 * under that id is a conflict. */
const receiptFor = (parts: Parts, accountId: string, operationId: string, command: string, inputDigest: string) =>
  Effect.gen(function* () {
    const receipt = yield* stored(parts.store.findReceipt(accountId, operationId))
    if (Option.isNone(receipt)) return Option.none<string>()
    if (receipt.value.inputDigest !== inputDigest || receipt.value.command !== command)
      return yield* OperationConflict.make({})
    return Option.some(receipt.value.result)
  })

/** A receipt for an operation the account is about to commit. */
const receiptRow = (accountId: string, operationId: string, command: string, inputDigest: string, result: string) =>
  Effect.map(nowDate, (createdAt) => ({ accountId, operationId, command, inputDigest, result, createdAt }))

/** The board an operation id already created, if any: the same board for the same name. Another name, or a
 * repeat after that board was deleted, is a conflict. */
const createdBefore = (parts: Parts, accountId: string, operationId: string, inputDigest: string) =>
  Effect.gen(function* () {
    const created = yield* receiptFor(parts, accountId, operationId, 'createBoard', inputDigest)
    if (Option.isNone(created)) return Option.none<Board>()
    const board = yield* one(parts, accountId, created.value).pipe(
      Effect.catchTag('BoardNotFound', () => Effect.fail(OperationConflict.make({}))),
    )
    return Option.some(board)
  })

const changes = (parts: Parts) => ({
  /** Start an empty board on plain paper, once per operation id. */
  createBoard: Effect.fn('Styld.Boards.create')(function* (input: CreateBoard) {
    const { accountId } = yield* CurrentAccount
    const inputDigest = yield* parts.digest(JSON.stringify([input.name]))
    const earlier = yield* createdBefore(parts, accountId, input.operationId, inputDigest)
    if (Option.isSome(earlier)) return earlier.value
    const id = yield* parts.newId('bd')
    const at = yield* nowDate
    const board: BoardRow = {
      id,
      accountId,
      name: input.name,
      paper: 'paper',
      version: 0,
      createdAt: at,
      updatedAt: at,
    }
    const receipt = yield* receiptRow(accountId, input.operationId, 'createBoard', inputDigest, id)
    const committed = yield* Effect.option(parts.store.createBoard(board, receipt))
    if (Option.isNone(committed)) {
      // A concurrent repeat of the operation may have committed first; its board answers.
      const repeat = yield* createdBefore(parts, accountId, input.operationId, inputDigest)
      return Option.isSome(repeat) ? repeat.value : yield* unavailable()
    }
    const [created] = yield* shown(parts, [board])
    return created ?? (yield* unavailable())
  }),
  /** Rename the board or change its paper. Its table is untouched, so the version stays. */
  updateBoard: Effect.fn('Styld.Boards.update')(function* (boardId: BoardId, input: UpdateBoard) {
    const { accountId } = yield* CurrentAccount
    const updated = yield* stored(
      parts.store.updateBoard(accountId, boardId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.paper === undefined ? {} : { paper: input.paper }),
        updatedAt: yield* nowDate,
      }),
    )
    if (Option.isNone(updated)) return yield* BoardNotFound.make({})
    const [board] = yield* shown(parts, [updated.value])
    return board ?? (yield* BoardNotFound.make({}))
  }),
  /** Delete the board, its items and its pictures' bytes. */
  deleteBoard: Effect.fn('Styld.Boards.delete')(function* (boardId: BoardId) {
    const { accountId } = yield* CurrentAccount
    // Pictures first: if the row's delete fails, a retry finds the board and finishes.
    const board = yield* ownBoard(parts, accountId, boardId)
    const keys = yield* stored(parts.store.imageKeys(board.id))
    yield* Effect.forEach(
      Array.chunksOf(keys, deleteBatch),
      (chunk) => Effect.tryPromise({ try: () => parts.bindings.bucket.delete([...chunk]), catch: unavailable }),
      { discard: true },
    )
    if (!(yield* stored(parts.store.deleteBoard(accountId, boardId)))) return yield* BoardNotFound.make({})
  }),
})

/** Why a table cannot be saved, if it cannot: two items with one id, a piece that is neither the account's nor
 * pinned on the board, or a picture that is not on this board. */
const tableRefusal = (parts: Parts, accountId: string, boardId: string, items: ReadonlyArray<BoardItem>) =>
  Effect.gen(function* () {
    if (new Set(items.map(({ id }) => id)).size !== items.length) return Option.some('duplicateId' as const)
    const pieceIds = [...new Set(items.filter(Schema.is(PieceItem)).map(({ pieceId }) => pieceId))]
    const owned = yield* stored(parts.store.ownPieces(accountId, pieceIds))
    const others = pieceIds.filter((id) => !owned.has(id))
    const pinned = others.length === 0 ? new Set<string>() : yield* stored(parts.store.piecesPinned(boardId, others))
    if (others.some((id) => !pinned.has(id))) return Option.some('pieceNotFound' as const)
    const imageIds = [...new Set(items.filter(Schema.is(ImageItem)).map(({ imageId }) => imageId))]
    const onBoard = yield* stored(parts.store.imagesOn(boardId, imageIds))
    if (imageIds.some((id) => !onBoard.has(id))) return Option.some('imageNotFound' as const)
    return Option.none()
  })

/** A save that did not land: the board changed or went since it was read, or D1 failed. */
const lostSave = (parts: Parts, accountId: string, boardId: string, version: number) =>
  Effect.gen(function* () {
    const board = yield* ownBoard(parts, accountId, boardId)
    return yield* board.version === version ? unavailable() : BoardVersionConflict.make({ version: board.version })
  })

/** New pins for things a board does not hold yet, the first of them newest. */
const newPins = (
  parts: Parts,
  boardId: string,
  targets: ReadonlyArray<Pick<BoardPinRow, 'kind' | 'pieceId' | 'lookId' | 'imageId'>>,
  at: Date,
) =>
  Effect.forEach(targets, (target, index) =>
    Effect.map(parts.newId('pn'), (id): BoardPinRow => ({
      id,
      boardId,
      ...target,
      createdAt: new Date(at.getTime() + targets.length - index),
    })),
  )

const pieceTarget = (pieceId: string) => ({ kind: 'piece' as const, pieceId, lookId: null, imageId: null })
const lookTarget = (lookId: string) => ({ kind: 'look' as const, pieceId: null, lookId, imageId: null })

const tables = (parts: Parts) => ({
  /** Replace the board's table with the editor's, from the version the editor loaded, pinning the pieces it
   * places; a board saved since answers its current version instead. The same operation id answers the
   * board as it is now. */
  saveBoardItems: Effect.fn('Styld.Boards.saveItems')(function* (boardId: BoardId, input: SaveBoardItems) {
    const { accountId } = yield* CurrentAccount
    const inputDigest = yield* parts.digest(JSON.stringify([boardId, input.version, input.items]))
    const command = 'saveBoardItems'
    if (Option.isSome(yield* receiptFor(parts, accountId, input.operationId, command, inputDigest)))
      return yield* one(parts, accountId, boardId)
    const board = yield* ownBoard(parts, accountId, boardId)
    if (board.version !== input.version) return yield* BoardVersionConflict.make({ version: board.version })
    const refusal = yield* tableRefusal(parts, accountId, boardId, input.items)
    if (Option.isSome(refusal)) return yield* BoardItemRefused.make({ reason: refusal.value })
    const placed = [...new Set(input.items.filter(Schema.is(PieceItem)).map(({ pieceId }) => pieceId))]
    const pinned = yield* stored(parts.store.piecesPinned(boardId, placed))
    const at = yield* nowDate
    const save = {
      accountId,
      boardId,
      version: input.version,
      items: input.items.map(itemRow),
      pins: yield* newPins(parts, boardId, placed.filter((id) => !pinned.has(id)).map(pieceTarget), at),
      receipt: yield* receiptRow(accountId, input.operationId, command, inputDigest, boardId),
      at,
    }
    const counted = yield* parts.store.saveItems(save).pipe(Effect.orElseSucceed(() => Option.none()))
    if (Option.isSome(counted)) return yield* one(parts, accountId, boardId)
    // A concurrent repeat of the operation may have committed first; the board answers then.
    if (Option.isSome(yield* receiptFor(parts, accountId, input.operationId, command, inputDigest)))
      return yield* one(parts, accountId, boardId)
    return yield* lostSave(parts, accountId, boardId, input.version)
  }),
})

/** Why these pieces and looks cannot be pinned, if they cannot. */
const pinRefusal = (
  parts: Parts,
  accountId: string,
  boardId: string,
  pieceIds: ReadonlyArray<string>,
  lookIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (pieceIds.length + lookIds.length === 0) return Option.some('nothingToPin' as const)
    const owned = yield* stored(parts.store.ownPieces(accountId, pieceIds))
    if (pieceIds.some((id) => !owned.has(id))) return Option.some('pieceNotFound' as const)
    const ownLooks = yield* stored(parts.lookStore.ownLooks(accountId, lookIds))
    if (lookIds.some((id) => !ownLooks.has(id))) return Option.some('lookNotFound' as const)
    const held = (yield* stored(parts.store.pinCounts([boardId]))).get(boardId) ?? 0
    if (held + pieceIds.length + lookIds.length > maximumBoardPins) return Option.some('boardFull' as const)
    return Option.none()
  })

const pinning = (parts: Parts) => ({
  /** Pin the account's pieces and looks on the board, the first of them newest; what is pinned already stays
   * where it is. The same operation id answers the board as it is now. */
  addPins: Effect.fn('Styld.Boards.addPins')(function* (boardId: BoardId, input: AddPins) {
    const { accountId } = yield* CurrentAccount
    const pieceIds = [...new Set(input.pieceIds ?? [])]
    const lookIds = [...new Set(input.lookIds ?? [])]
    const inputDigest = yield* parts.digest(JSON.stringify([boardId, pieceIds, lookIds]))
    if (Option.isSome(yield* receiptFor(parts, accountId, input.operationId, 'addPins', inputDigest)))
      return yield* one(parts, accountId, boardId)
    yield* ownBoard(parts, accountId, boardId)
    const refusal = yield* pinRefusal(parts, accountId, boardId, pieceIds, lookIds)
    if (Option.isSome(refusal)) return yield* PinRefused.make({ reason: refusal.value })
    const at = yield* nowDate
    const pins = yield* newPins(parts, boardId, [...pieceIds.map(pieceTarget), ...lookIds.map(lookTarget)], at)
    const receipt = yield* receiptRow(accountId, input.operationId, 'addPins', inputDigest, boardId)
    const committed = yield* Effect.option(parts.store.addPins(accountId, boardId, pins, receipt, at))
    if (
      Option.isNone(committed) &&
      Option.isNone(yield* receiptFor(parts, accountId, input.operationId, 'addPins', inputDigest))
    )
      return yield* unavailable()
    return yield* one(parts, accountId, boardId)
  }),
  /** Take pins off the board and their pieces and pictures off its table; a picture taken off is deleted.
   * The table changes, so its version moves on. The same operation id answers the board as it is now. */
  removePins: Effect.fn('Styld.Boards.removePins')(function* (boardId: BoardId, input: RemovePins) {
    const { accountId } = yield* CurrentAccount
    const pinIds = [...new Set(input.pinIds)]
    const inputDigest = yield* parts.digest(JSON.stringify([boardId, pinIds]))
    if (Option.isSome(yield* receiptFor(parts, accountId, input.operationId, 'removePins', inputDigest)))
      return yield* one(parts, accountId, boardId)
    yield* ownBoard(parts, accountId, boardId)
    const pins = yield* stored(parts.store.pinsOn(boardId, pinIds))
    const imageIds = pins.flatMap(({ imageId }) => (imageId === null ? [] : [imageId]))
    const keys = yield* stored(parts.store.imageKeysOf(boardId, imageIds))
    const removal: PinRemoval = {
      accountId,
      boardId,
      pinIds,
      pieceIds: pins.flatMap(({ pieceId }) => (pieceId === null ? [] : [pieceId])),
      imageIds,
      receipt: yield* receiptRow(accountId, input.operationId, 'removePins', inputDigest, boardId),
      at: yield* nowDate,
    }
    const committed = yield* Effect.option(parts.store.removePins(removal))
    if (Option.isNone(committed)) {
      if (Option.isNone(yield* receiptFor(parts, accountId, input.operationId, 'removePins', inputDigest)))
        return yield* unavailable()
      return yield* one(parts, accountId, boardId)
    }
    // The rows are gone; bytes a failed delete leaves behind sit under the account's prefix, which account
    // deletion clears.
    if (keys.length > 0)
      yield* Effect.ignore(
        Effect.tryPromise({ try: () => parts.bindings.bucket.delete([...keys]), catch: unavailable }),
      )
    return yield* one(parts, accountId, boardId)
  }),
})

/** The answer to an operation id that already added a picture: the same picture, while its board exists. */
const replayImage = (parts: Parts, accountId: string, imageId: string) =>
  Effect.gen(function* () {
    const image = yield* stored(parts.store.findImage(accountId, imageId))
    if (Option.isNone(image)) return yield* BoardNotFound.make({})
    const replayed: BoardImage = { imageId: BoardImageId.make(image.value.id) }
    return replayed
  })

/** A batch the store refused. If the same operation committed after all, its receipt answers; otherwise the
 * upload was spent meanwhile, the board went, or D1 failed. */
const addImageFailure = (
  parts: Parts,
  input: AddBoardImage & { readonly accountId: string; readonly boardId: string; readonly inputDigest: string },
) =>
  Effect.gen(function* () {
    const receipt = yield* stored(parts.store.findReceipt(input.accountId, input.operationId))
    if (Option.isSome(receipt) && receipt.value.inputDigest === input.inputDigest)
      return yield* replayImage(parts, input.accountId, receipt.value.result)
    yield* ownBoard(parts, input.accountId, input.boardId)
    yield* usableUpload(parts.wardrobeStore, input.accountId, input.uploadId)
    return yield* unavailable()
  })

const pictures = (parts: Parts) => ({
  /** A received photo upload becomes a picture on the board. The same operation id answers the same picture;
   * using it for another upload or board is a conflict. */
  addBoardImage: Effect.fn('Styld.Boards.addImage')(function* (boardId: BoardId, input: AddBoardImage) {
    const { accountId } = yield* CurrentAccount
    const inputDigest = yield* parts.digest(JSON.stringify([boardId, input.uploadId]))
    const receipt = yield* stored(parts.store.findReceipt(accountId, input.operationId))
    if (Option.isSome(receipt))
      return receipt.value.inputDigest === inputDigest && receipt.value.command === 'addBoardImage'
        ? yield* replayImage(parts, accountId, receipt.value.result)
        : yield* OperationConflict.make({})
    yield* ownBoard(parts, accountId, boardId)
    const upload = yield* usableUpload(parts.wardrobeStore, accountId, input.uploadId)
    if (!upload.contentType.startsWith('image/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const id = yield* parts.newId('bm')
    const pinId = yield* parts.newId('pn')
    const at = yield* nowDate
    const added = yield* receiptRow(accountId, input.operationId, 'addBoardImage', inputDigest, id)
    const image = { id, accountId, boardId, contentType: upload.contentType, createdAt: at }
    const committed = yield* parts.store.addImage(image, pinId, upload.id, added).pipe(
      Effect.as(Option.none<BoardImage>()),
      Effect.catchTag('StoreUnavailable', () =>
        addImageFailure(parts, { ...input, accountId, boardId, inputDigest }).pipe(Effect.map(Option.some)),
      ),
    )
    return Option.getOrElse(committed, (): BoardImage => ({ imageId: BoardImageId.make(id) }))
  }),
  /** A board picture for its owner, resized to WebP by the Images binding; another account's reads as none.
   * A picture never changes, so its id and size are its version. */
  boardImage: Effect.fn('Styld.Boards.image')(function* (imageId: BoardImageId, size: ImageSize) {
    const { accountId } = yield* CurrentAccount
    const image = yield* stored(parts.store.findImage(accountId, imageId))
    if (Option.isNone(image)) return Option.none<ShownImage>()
    const { objectKey, contentType } = image.value
    const delivered = yield* deliverImage(parts.bindings, { key: objectKey, contentType }, size)
    return Option.map(delivered, (shownImage): ShownImage => ({ ...shownImage, version: `${imageId}.${size}` }))
  }),
})

const make = (bindings: BoardBindings) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const encoder = new TextEncoder()
    const parts: Parts = {
      bindings,
      store: makeBoardStore(bindings.database),
      wardrobeStore: makeStore(bindings.database),
      lookStore: makeLookStore(bindings.database),
      newId: (prefix) =>
        Effect.map(crypto.randomBytes(16), (bytes) => `${prefix}_${Base64Url.encode(bytes)}`).pipe(
          Effect.mapError(unavailable),
        ),
      digest: (text) =>
        Effect.map(crypto.digest('SHA-256', encoder.encode(text)), Base64Url.encode).pipe(Effect.mapError(unavailable)),
    }
    return { ...reads(parts), ...changes(parts), ...tables(parts), ...pinning(parts), ...pictures(parts) }
  })

/** Boards, for the website. Every operation acts for `CurrentAccount`, which HTTP provides per request, so no
 * operation takes whose boards they are from its input. */
export class Boards extends Context.Service<Boards, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/Boards',
) {}

/** Boards over the Worker's bindings. Build it once per isolate. */
export const makeBoards = (bindings: BoardBindings) => Effect.map(make(bindings), (service) => Boards.of(service))
