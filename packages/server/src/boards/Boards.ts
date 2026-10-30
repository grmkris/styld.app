import {
  type AddBoardImage,
  type AddPins,
  Board,
  type BoardId,
  type BoardImage,
  BoardImageId,
  BoardNotFound,
  type CreateBoard,
  maximumBoardPins,
  OperationConflict,
  PinRefused,
  type RemovePins,
  searchText,
  type SetVisibility,
  type UpdateBoard,
  UploadRefused,
} from '@styld/protocol'
import { Array, Context, Effect, Option } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { CurrentAccount } from '../CurrentAccount.ts'
import { makeLookStore } from '../looks/Store.ts'
import type { Checks } from '../safety/Checks.ts'
import { makeProfileStore, requirePublished } from '../social/ProfileStore.ts'
import { deliverImage } from '../wardrobe/Delivery.ts'
import type { ShownImage } from '../wardrobe/Http.ts'
import type { ImageSize } from '../wardrobe/Media.ts'
import { makeStore } from '../wardrobe/Store.ts'
import { usableUpload } from '../wardrobe/Wardrobe.ts'
import { type BoardRow, makeBoardStore, type PinRemoval } from './Store.ts'
import { tables } from './Tables.ts'
import {
  lookTarget,
  newPins,
  nowDate,
  one,
  ownBoard,
  pieceTarget,
  pinnedPiecesChecked,
  receiptFor,
  rechecked,
  receiptRow,
  shown,
  stored,
  summaries,
  type BoardBindings,
  type Parts,
  unavailable,
} from './Parts.ts'

/** R2 deletes at most this many keys per call. */
const deleteBatch = 1000

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
      visibility: 'private',
      moods: [],
      publishedAt: null,
      featuredAt: null,
      searchText: searchText(input.name),
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
        ...(input.name === undefined ? {} : { name: input.name, searchText: searchText(input.name) }),
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

const publishing = (parts: Parts) => ({
  /** Make the board public, which needs a published profile, or private again. A public board is checked as it
   * is now, and its own pieces through the queue; others see it once the check lets them. */
  setBoardVisibility: Effect.fn('Styld.Boards.setVisibility')(function* (boardId: BoardId, input: SetVisibility) {
    const { accountId } = yield* CurrentAccount
    const board = yield* ownBoard(parts, accountId, boardId)
    if (input.visibility === 'public') yield* requirePublished(parts.profileStore, accountId)
    const goesPublic = input.visibility === 'public' && board.visibility !== 'public'
    yield* stored(
      parts.store.updateBoard(accountId, boardId, {
        visibility: input.visibility,
        publishedAt: goesPublic ? yield* nowDate : board.publishedAt,
      }),
    )
    if (input.visibility === 'public') {
      yield* parts.checks.checkNow({ kind: 'board', id: boardId })
      yield* pinnedPiecesChecked(parts, accountId, boardId)
    }
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

const make = (bindings: BoardBindings, checks: Checks['Service']) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const encoder = new TextEncoder()
    const parts: Parts = {
      bindings,
      store: makeBoardStore(bindings.database),
      wardrobeStore: makeStore(bindings.database),
      lookStore: makeLookStore(bindings.database),
      profileStore: makeProfileStore(bindings.database),
      checks,
      newId: (prefix) =>
        Effect.map(crypto.randomBytes(16), (bytes) => `${prefix}_${Base64Url.encode(bytes)}`).pipe(
          Effect.mapError(unavailable),
        ),
      digest: (text) =>
        Effect.map(crypto.digest('SHA-256', encoder.encode(text)), Base64Url.encode).pipe(Effect.mapError(unavailable)),
    }
    const edits = { ...changes(parts), ...tables(parts), ...pinning(parts), ...pictures(parts) }
    return {
      ...reads(parts),
      ...edits,
      ...publishing(parts),
      updateBoard: rechecked(parts, edits.updateBoard),
      saveBoardItems: rechecked(parts, edits.saveBoardItems),
      arrangeBoard: rechecked(parts, edits.arrangeBoard),
      setTable: rechecked(parts, edits.setTable),
      addPins: rechecked(parts, edits.addPins),
      removePins: rechecked(parts, edits.removePins),
      addBoardImage: rechecked(parts, edits.addBoardImage),
    }
  })

/** Boards, for the website. Every operation acts for `CurrentAccount`, which HTTP provides per request, so no
 * operation takes whose boards they are from its input. */
export class Boards extends Context.Service<Boards, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/Boards',
) {}

/** Boards over the Worker's bindings, checked by the Worker's checks. Build it once per isolate. */
export const makeBoards = (bindings: BoardBindings, checks: Checks['Service']) =>
  Effect.map(make(bindings, checks), (service) => Boards.of(service))
