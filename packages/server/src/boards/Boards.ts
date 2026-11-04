import { imageAddresses } from '../kernel/SignedMedia.ts'
import {
  type AddBoardImage,
  type AnotherOutfit,
  type BoardOutfitId,
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
  type Unavailable,
  UploadRefused,
} from '@styld/protocol'
import { Context, Effect, Layer, Option } from 'effect'

import { ownLookIds } from '../looks/Store.ts'
import { Checks } from '../safety/Checks.ts'
import { requirePublished } from '../social/ProfileStore.ts'

import { ownPieceIds } from '../wardrobe/Store.ts'
import { usableUpload } from '../wardrobe/Shared.ts'
import { type BoardRow, type PinRemoval } from './Store.ts'
import { tables } from './Tables.ts'
import { keeping } from './Keeping.ts'
import { template } from './Template.ts'
import { placePins } from './PinTable.ts'
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
      template: null,
      anchorPieceId: null,
      layout: null,
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
  /** Rename the board, change its paper or moods, once per operation id: a repeat answers the board as it is now and
   * writes nothing, so it never undoes a later change. */
  updateBoard: Effect.fn('Styld.Boards.update')(function* (boardId: BoardId, input: UpdateBoard) {
    const { accountId } = yield* CurrentAccount
    const store = yield* BoardStore
    const { operationId, ...edit } = input
    const write = Effect.gen(function* () {
      yield* ownBoard(accountId, boardId)
      const update = store.updateBoard(accountId, boardId, {
        ...(edit.name === undefined ? {} : { name: edit.name, searchText: searchText(edit.name) }),
        ...(edit.paper === undefined ? {} : { paper: edit.paper }),
        ...(edit.moods === undefined ? {} : { moods: [...new Set(edit.moods)] }),
        updatedAt: yield* nowDate,
      })
      return { statements: [update], result: boardId }
    })
    return yield* store.recorded(
      { accountId, operationId, command: 'updateBoard', input: [boardId, edit] },
      { write, answer: () => one(accountId, boardId) },
    )
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
  placeOnTable: boolean,
) =>
  Effect.gen(function* () {
    if (pieceIds.length + lookIds.length === 0) return Option.some('nothingToPin' as const)
    const owned = yield* stored(ownPieceIds(yield* Database, accountId, pieceIds))
    if (pieceIds.some((id) => !owned.has(id))) return Option.some('pieceNotFound' as const)
    const ownLooks = yield* stored(ownLookIds(yield* Database, accountId, lookIds))
    if (lookIds.some((id) => !ownLooks.has(id))) return Option.some('lookNotFound' as const)
    // Canvas placement checks only newly added pins against capacity inside its versioned retry.
    if (placeOnTable) return Option.none()
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
      input: [boardId, pieceIds, lookIds, ...(input.placeOnTable ? [true] : [])],
    })
    if (Option.isSome(yield* priorOf(operation))) return yield* one(accountId, boardId)
    yield* ownBoard(accountId, boardId)
    const refusal = yield* pinRefusal(accountId, boardId, pieceIds, lookIds, input.placeOnTable ?? false)
    if (Option.isSome(refusal)) return yield* PinRefused.make({ reason: refusal.value })
    if (input.placeOnTable) return yield* placePins(boardId, pieceIds, lookIds, operation)
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
  /** Make the board public or private, once per operation id: a repeat writes nothing, so an old request to make it
   * public never undoes a later one that made it private. */
  setBoardVisibility: Effect.fn('Styld.Boards.setVisibility')(function* (boardId: BoardId, input: SetVisibility) {
    const { accountId } = yield* CurrentAccount
    const store = yield* BoardStore
    const { operationId, visibility } = input
    const write = Effect.gen(function* () {
      const board = yield* ownBoard(accountId, boardId)
      if (visibility === 'public') yield* requirePublished(yield* Database, accountId)
      const goesPublic = visibility === 'public' && board.visibility !== 'public'
      const update = store.updateBoard(accountId, boardId, {
        visibility,
        publishedAt: goesPublic ? yield* nowDate : board.publishedAt,
      })
      return { statements: [update], result: boardId }
    })
    const answer = () =>
      Effect.gen(function* () {
        const board = yield* one(accountId, boardId)
        if (board.visibility !== 'public') return board
        yield* (yield* Checks).checkNow({ kind: 'board', id: boardId })
        yield* pinnedPiecesChecked(accountId, boardId)
        return yield* one(accountId, boardId)
      })
    return yield* store.recorded(
      { accountId, operationId, command: 'setBoardVisibility', input: [boardId, visibility] },
      { write, answer },
    )
  }, Effect.provide(context)),
}))

/** The answer to an operation id that already added a picture: the same picture, while its board exists. */
const replayImage = (accountId: string, imageId: string) =>
  Effect.gen(function* () {
    const image = yield* stored((yield* BoardStore).findImage(accountId, imageId))
    if (Option.isNone(image)) return yield* NotFound.make({})
    const addresses = yield* imageAddresses({
      entityId: image.value.id,
      key: image.value.objectKey,
      contentType: image.value.contentType,
      version: String(image.value.createdAt.getTime()),
    })
    const replayed: BoardImage = {
      imageId: BoardImageId.make(image.value.id),
      ...Option.match(addresses, { onNone: () => ({}), onSome: (addresses_) => ({ image: addresses_ }) }),
    }
    return replayed
  })

/** A batch the store refused. If the same operation committed after all, its receipt answers; otherwise the
 * upload was spent meanwhile, the board went, or D1 failed. */
const addImageFailure = (operation: Identified, boardId: string, uploadId: string) =>
  Effect.gen(function* () {
    const prior = yield* priorOf(operation)
    if (Option.isSome(prior)) return yield* replayImage(operation.accountId, prior.value)
    yield* ownBoard(operation.accountId, boardId)
    yield* usableUpload(operation.accountId, uploadId)
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
    const upload = yield* usableUpload(accountId, input.uploadId)
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
    return Option.isSome(committed) ? committed.value : yield* replayImage(accountId, id)
  }, Effect.provide(context)),
  /** Where a picture from elsewhere in the account (an outfit photo, a try-on) goes on a board: the picture one of
   * `operationIds` already put on this board and that is still there, or else the first of them no picture took yet,
   * to add it under. Callers key the first id by the picture and the board, so putting it on again answers the same
   * picture, and derive the next from the request, for a picture taken off the board since. */
  pictureSpot: Effect.fn('Styld.Boards.pictureSpot')(function* (
    boardId: BoardId,
    operationIds: ReadonlyArray<OperationId>,
  ): Effect.fn.Return<PictureSpot, NotFound | OperationConflict | Unavailable, BoardServices | CurrentAccount> {
    const { accountId } = yield* CurrentAccount
    yield* ownBoard(accountId, boardId)
    const store = yield* BoardStore
    for (const operationId of operationIds) {
      const receipt = yield* stored(store.findReceipt(accountId, operationId))
      if (Option.isNone(receipt)) return { _tag: 'Free', operationId }
      const held = yield* heldImage(accountId, boardId, receipt.value.result)
      if (receipt.value.command === 'addBoardImage' && Option.isSome(held)) return { _tag: 'Held', image: held.value }
    }
    return yield* OperationConflict.make({})
  }, Effect.provide(context)),
  /** A picture that is on the board, as `addBoardImage` answered it; one taken off since is not found. */
  boardPicture: Effect.fn('Styld.Boards.picture')(function* (boardId: BoardId, imageId: string) {
    const { accountId } = yield* CurrentAccount
    const held = yield* heldImage(accountId, boardId, imageId)
    return Option.isSome(held) ? held.value : yield* NotFound.make({})
  }, Effect.provide(context)),
}))

/** The board's picture under the id, if it is still on that board. */
const heldImage = (accountId: string, boardId: string, imageId: string | null) =>
  Effect.gen(function* () {
    if (imageId === null) return Option.none<BoardImage>()
    const row = yield* stored((yield* BoardStore).findImage(accountId, imageId))
    if (Option.isNone(row) || row.value.boardId !== boardId) return Option.none<BoardImage>()
    return Option.some(yield* replayImage(accountId, row.value.id))
  })

/** Where a picture from elsewhere goes on a board (`pictureSpot`): it is there already, or it goes under this id. */
type PictureSpot =
  | { readonly _tag: 'Held'; readonly image: BoardImage }
  | { readonly _tag: 'Free'; readonly operationId: OperationId }

const make = Effect.gen(function* () {
  const context = yield* Effect.context<BoardServices>()
  /** An edit, rechecked after it (`rechecked`) over the layer's services. */
  const checked =
    <I, A, E, R>(edit: (boardId: BoardId, input: I) => Effect.Effect<A, E, R>) =>
    (boardId: BoardId, input: I) =>
      rechecked(edit)(boardId, input).pipe(Effect.provide(context))
  const edits = {
    ...(yield* changes),
    ...(yield* tables),
    ...(yield* pinning),
    ...(yield* pictures),
    ...(yield* keeping),
    ...(yield* template),
  }
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
    keepLook: checked(edits.keepLook),
    anotherOutfit: (boardId: BoardId, outfitId: BoardOutfitId, input: AnotherOutfit) =>
      checked((id: BoardId, change: AnotherOutfit) => edits.anotherOutfit(id, outfitId, change))(boardId, input),
    anotherLayout: checked(edits.anotherLayout),
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
