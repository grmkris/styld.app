import {
  type AddBoardImage,
  type AddPins,
  Board,
  type BoardId,
  type BoardImage,
  BoardImageId,
  type CreateBoard,
  CurrentAccount,
  maximumBoardPins,
  NotFound,
  OperationConflict,
  type OperationId,
  PinRefused,
  type RemovePins,
  searchText,
  type SetVisibility,
  type UpdateBoard,
  UploadRefused,
} from '@styld/protocol'
import { Context, Effect, Layer, Option } from 'effect'

import { ownLookIds } from '../looks/Store.ts'
import { Checks } from '../safety/Checks.ts'
import { requirePublished } from '../social/ProfileStore.ts'

import { deliverImage } from '../wardrobe/Delivery.ts'
import type { ShownImage } from '../wardrobe/Http.ts'
import type { ImageSize } from '../wardrobe/Media.ts'
import { ownPieceIds, WardrobeStore } from '../wardrobe/Store.ts'
import { usableUpload } from '../wardrobe/Parts.ts'
import { type BoardRow, type PinRemoval } from './Store.ts'
import { tables } from './Tables.ts'
import {
  lookTarget,
  newPins,
  one,
  ownBoard,
  pieceTarget,
  pinnedPiecesChecked,
  priorOf,
  rechecked,
  shown,
  stored,
  summaries,
  unavailable,
} from './Shared.ts'
import { Database, nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { deleting, identify, receiptRow, type Identified } from '../kernel/Receipts.ts'
import { deleteAfterRows, Media } from '../kernel/Media.ts'
import { BoardStore } from './Store.ts'
import type { BoardServices } from './Shared.ts'

/** Where a board picture came from: an upload, a picture Styld generated, or an outfit photo of My Gallery. */
type ImageOrigin = 'upload' | 'generated' | 'photo'

const reads = Effect.map(Effect.context<BoardServices>(), (context) => ({
  /** The account's boards, the most recently changed first. */
  listBoards: Effect.fn('Styld.Boards.list')(function* () {
    const { accountId } = yield* CurrentAccount
    return yield* summaries(yield* stored((yield* BoardStore).listBoards(accountId)))
  }, Effect.provide(context)),
  getBoard: Effect.fn('Styld.Boards.get')(function* (boardId: BoardId) {
    const { accountId } = yield* CurrentAccount
    return yield* one(accountId, boardId)
  }, Effect.provide(context)),
}))

/** The board an operation id already created, if any: the same board for the same name. Another name, or a
 * repeat after that board was deleted, is a conflict. */
const createdBefore = (operation: Identified) =>
  Effect.gen(function* () {
    const created = yield* priorOf(operation)
    if (Option.isNone(created)) return Option.none<Board>()
    const board = yield* one(operation.accountId, created.value).pipe(
      Effect.catchTag('NotFound', () => Effect.fail(OperationConflict.make({}))),
    )
    return Option.some(board)
  })

const changes = Effect.map(Effect.context<BoardServices>(), (context) => ({
  /** Start an empty board on plain paper, once per operation id. */
  createBoard: Effect.fn('Styld.Boards.create')(function* (input: CreateBoard) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'createBoard',
      input: [input.name],
    })
    const earlier = yield* createdBefore(operation)
    if (Option.isSome(earlier)) return earlier.value
    const id = yield* newId('bd')
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
    const receipt = yield* receiptRow(operation, id)
    const committed = yield* Effect.option((yield* BoardStore).createBoard(board, receipt))
    if (Option.isNone(committed)) {
      // A concurrent repeat of the operation may have committed first; its board answers.
      const repeat = yield* createdBefore(operation)
      return Option.isSome(repeat) ? repeat.value : yield* unavailable()
    }
    const [created] = yield* shown([board])
    return created ?? (yield* unavailable())
  }, Effect.provide(context)),
  /** Rename the board or change its paper. Its table is untouched, so the version stays. */
  updateBoard: Effect.fn('Styld.Boards.update')(function* (boardId: BoardId, input: UpdateBoard) {
    const { accountId } = yield* CurrentAccount
    const updated = yield* stored(
      (yield* BoardStore).updateBoard(accountId, boardId, {
        ...(input.name === undefined ? {} : { name: input.name, searchText: searchText(input.name) }),
        ...(input.paper === undefined ? {} : { paper: input.paper }),
        ...(input.moods === undefined ? {} : { moods: [...new Set(input.moods)] }),
        updatedAt: yield* nowDate,
      }),
    )
    if (Option.isNone(updated)) return yield* NotFound.make({})
    const [board] = yield* shown([updated.value])
    return board ?? (yield* NotFound.make({}))
  }, Effect.provide(context)),
  /** Delete the board with its items, pins, pictures and check, then its pictures' bytes. A repeat of the same delete
   * answers done. */
  deleteBoard: Effect.fn('Styld.Boards.delete')(function* (boardId: BoardId, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    yield* deleting(yield* BoardStore, { accountId, operationId, command: 'deleteBoard', target: boardId }, (receipt) =>
      Effect.gen(function* () {
        const board = yield* ownBoard(accountId, boardId)
        const keys = yield* stored((yield* BoardStore).imageKeys(board.id))
        if (!(yield* stored((yield* BoardStore).deleteBoard(accountId, boardId, receipt))))
          return yield* NotFound.make({})
        yield* deleteAfterRows((yield* Media).bucket, keys, 'board')
      }),
    )
  }, Effect.provide(context)),
}))

/** Why these pieces and looks cannot be pinned, if they cannot. */
const pinRefusal = (
  accountId: string,
  boardId: string,
  pieceIds: ReadonlyArray<string>,
  lookIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (pieceIds.length + lookIds.length === 0) return Option.some('nothingToPin' as const)
    const owned = yield* stored(ownPieceIds(yield* Database, accountId, pieceIds))
    if (pieceIds.some((id) => !owned.has(id))) return Option.some('pieceNotFound' as const)
    const ownLooks = yield* stored(ownLookIds(yield* Database, accountId, lookIds))
    if (lookIds.some((id) => !ownLooks.has(id))) return Option.some('lookNotFound' as const)
    const held = (yield* stored((yield* BoardStore).pinCounts([boardId]))).get(boardId) ?? 0
    if (held + pieceIds.length + lookIds.length > maximumBoardPins) return Option.some('boardFull' as const)
    return Option.none()
  })

const pinning = Effect.map(Effect.context<BoardServices>(), (context) => ({
  /** Pin the account's pieces and looks on the board, the first of them newest; what is pinned already stays
   * where it is. The same operation id answers the board as it is now. */
  addPins: Effect.fn('Styld.Boards.addPins')(function* (boardId: BoardId, input: AddPins) {
    const { accountId } = yield* CurrentAccount
    const pieceIds = [...new Set(input.pieceIds ?? [])]
    const lookIds = [...new Set(input.lookIds ?? [])]
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'addPins',
      input: [boardId, pieceIds, lookIds],
    })
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    yield* ownBoard(accountId, boardId)
    const refusal = yield* pinRefusal(accountId, boardId, pieceIds, lookIds)
    if (Option.isSome(refusal)) return yield* PinRefused.make({ reason: refusal.value })
    const at = yield* nowDate
    const pins = yield* newPins(boardId, [...pieceIds.map(pieceTarget), ...lookIds.map(lookTarget)], at)
    const receipt = yield* receiptRow(operation, boardId)
    const committed = yield* Effect.option((yield* BoardStore).addPins(accountId, boardId, pins, receipt, at))
    if (Option.isNone(committed) && Option.isNone(yield* priorOf(operation))) return yield* unavailable()
    return yield* one(accountId, boardId)
  }, Effect.provide(context)),
  /** Take pins off the board and their pieces and pictures off its table; a picture taken off is deleted.
   * The table changes, so its version moves on. The same operation id answers the board as it is now. */
  removePins: Effect.fn('Styld.Boards.removePins')(function* (boardId: BoardId, input: RemovePins) {
    const { accountId } = yield* CurrentAccount
    const pinIds = [...new Set(input.pinIds)]
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'removePins',
      input: [boardId, pinIds],
    })
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    yield* ownBoard(accountId, boardId)
    const pins = yield* stored((yield* BoardStore).pinsOn(boardId, pinIds))
    const imageIds = pins.flatMap(({ imageId }) => (imageId === null ? [] : [imageId]))
    const keys = yield* stored((yield* BoardStore).imageKeysOf(boardId, imageIds))
    const removal: PinRemoval = {
      accountId,
      boardId,
      pinIds,
      pieceIds: pins.flatMap(({ pieceId }) => (pieceId === null ? [] : [pieceId])),
      imageIds,
      receipt: yield* receiptRow(operation, boardId),
      at: yield* nowDate,
    }
    const committed = yield* Effect.option((yield* BoardStore).removePins(removal))
    if (Option.isNone(committed)) {
      if (Option.isNone(yield* priorOf(operation))) return yield* unavailable()
      return yield* one(accountId, boardId)
    }
    yield* deleteAfterRows((yield* Media).bucket, keys, 'pin')
    return yield* one(accountId, boardId)
  }, Effect.provide(context)),
}))

const publishing = Effect.map(Effect.context<BoardServices>(), (context) => ({
  /** Make the board public, which needs a published profile, or private again. A public board is checked as it
   * is now, and its own pieces through the queue; others see it once the check lets them. */
  setBoardVisibility: Effect.fn('Styld.Boards.setVisibility')(function* (boardId: BoardId, input: SetVisibility) {
    const { accountId } = yield* CurrentAccount
    const board = yield* ownBoard(accountId, boardId)
    if (input.visibility === 'public') yield* requirePublished(yield* Database, accountId)
    const goesPublic = input.visibility === 'public' && board.visibility !== 'public'
    yield* stored(
      (yield* BoardStore).updateBoard(accountId, boardId, {
        visibility: input.visibility,
        publishedAt: goesPublic ? yield* nowDate : board.publishedAt,
      }),
    )
    if (input.visibility === 'public') {
      yield* (yield* Checks).checkNow({ kind: 'board', id: boardId })
      yield* pinnedPiecesChecked(accountId, boardId)
    }
    return yield* one(accountId, boardId)
  }, Effect.provide(context)),
}))

/** The answer to an operation id that already added a picture: the same picture, while its board exists. */
const replayImage = (accountId: string, imageId: string) =>
  Effect.gen(function* () {
    const image = yield* stored((yield* BoardStore).findImage(accountId, imageId))
    if (Option.isNone(image)) return yield* NotFound.make({})
    const replayed: BoardImage = { imageId: BoardImageId.make(image.value.id) }
    return replayed
  })

/** A batch the store refused. If the same operation committed after all, its receipt answers; otherwise the
 * upload was spent meanwhile, the board went, or D1 failed. */
const addImageFailure = (operation: Identified, boardId: string, uploadId: string) =>
  Effect.gen(function* () {
    const prior = yield* priorOf(operation)
    if (Option.isSome(prior)) return yield* replayImage(operation.accountId, prior.value)
    yield* ownBoard(operation.accountId, boardId)
    yield* usableUpload(yield* WardrobeStore, operation.accountId, uploadId)
    return yield* unavailable()
  })

const pictures = Effect.map(Effect.context<BoardServices>(), (context) => ({
  /** A received photo upload becomes a picture on the board, marked with where it came from. The same operation id
   * answers the same picture; using it for another upload or board is a conflict. */
  addBoardImage: Effect.fn('Styld.Boards.addImage')(function* (
    boardId: BoardId,
    input: AddBoardImage,
    origin: ImageOrigin = 'upload',
  ) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'addBoardImage',
      input: [boardId, input.uploadId],
    })
    const prior = yield* priorOf(operation)
    if (Option.isSome(prior)) return yield* replayImage(accountId, prior.value)
    yield* ownBoard(accountId, boardId)
    const upload = yield* usableUpload(yield* WardrobeStore, accountId, input.uploadId)
    if (!upload.contentType.startsWith('image/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const id = yield* newId('bm')
    const pinId = yield* newId('pn')
    const at = yield* nowDate
    const added = yield* receiptRow(operation, id)
    const image = {
      id,
      accountId,
      boardId,
      contentType: upload.contentType,
      origin,
      createdAt: at,
    }
    const committed = yield* (yield* BoardStore).addImage(image, pinId, upload.id, added).pipe(
      Effect.as(Option.none<BoardImage>()),
      Effect.catchTag('StoreUnavailable', () =>
        addImageFailure(operation, boardId, input.uploadId).pipe(Effect.map(Option.some)),
      ),
    )
    return Option.getOrElse(committed, (): BoardImage => ({ imageId: BoardImageId.make(id) }))
  }, Effect.provide(context)),
  /** A board picture for its owner, resized to WebP by the Images binding; another account's reads as none.
   * A picture never changes, so its id and size are its version. */
  boardImage: Effect.fn('Styld.Boards.image')(function* (imageId: BoardImageId, size: ImageSize) {
    const { accountId } = yield* CurrentAccount
    const image = yield* stored((yield* BoardStore).findImage(accountId, imageId))
    if (Option.isNone(image)) return Option.none<ShownImage>()
    const { objectKey, contentType } = image.value
    const delivered = yield* deliverImage(yield* Media, { key: objectKey, contentType }, size)
    return Option.map(delivered, (shownImage): ShownImage => ({ ...shownImage, version: `${imageId}.${size}` }))
  }, Effect.provide(context)),
}))

const make = Effect.gen(function* () {
  const context = yield* Effect.context<BoardServices>()
  /** An edit, rechecked after it (`rechecked`) over the layer's services. */
  const checked =
    <I, A, E, R>(edit: (boardId: BoardId, input: I) => Effect.Effect<A, E, R>) =>
    (boardId: BoardId, input: I) =>
      rechecked(edit)(boardId, input).pipe(Effect.provide(context))
  const edits = { ...(yield* changes), ...(yield* tables), ...(yield* pinning), ...(yield* pictures) }
  return {
    ...(yield* reads),
    ...edits,
    ...(yield* publishing),
    updateBoard: checked(edits.updateBoard),
    saveBoardItems: checked(edits.saveBoardItems),
    arrangeBoard: checked(edits.arrangeBoard),
    setTable: checked(edits.setTable),
    addPins: checked(edits.addPins),
    removePins: checked(edits.removePins),
    addBoardImage: checked(edits.addBoardImage),
    /** A picture Styld generated for the board, marked Generated. */
    addGeneratedImage: checked((boardId: BoardId, input: AddBoardImage) =>
      edits.addBoardImage(boardId, input, 'generated'),
    ),
    /** One of the person's outfit photos (My Gallery), held back from visitors. */
    addPhotoImage: checked((boardId: BoardId, input: AddBoardImage) => edits.addBoardImage(boardId, input, 'photo')),
  }
})

/** Boards, for the website and for assistants. Every operation acts for `CurrentAccount`, which HTTP and MCP provide
 * per request, so no operation takes whose boards they are from its input. */
export class Boards extends Context.Service<Boards, Effect.Success<typeof make>>()('@styld/server/boards/Boards') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Boards.of(service)),
  )
}
