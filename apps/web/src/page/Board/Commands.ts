import { drawOperationId } from '../../OperationIds.ts'
import {
  BoardId,
  BoardItem,
  BoardItemId,
  boardWidth,
  Paper,
  PhotoId,
  PhotoPicture,
  PieceId,
  TryOnId,
} from '@styld/protocol'
import { Array, Duration, Effect, Option, Predicate, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import * as Base64Url from 'effect/encoding/Base64Url'
import { Command, File, Mount } from 'foldkit'
import { observed } from '../../Observe.ts'
import { uploadPicture } from '../../Upload.ts'
import { StyldClient } from '../../StyldClient.ts'
import { Message } from './Message.ts'

// COMMAND

/** How long a change waits for the next before the table is saved. */
const saveWait = Duration.millis(700)
/** How long an item's exit plays before it leaves the page. */
const exitDuration = Duration.millis(240)
/** How long "Removed. Undo" stays. */
const toastDuration = Duration.seconds(5)

const boardIdOf = (id: string) => Schema.decodeUnknownEffect(BoardId)(id)

/** How long one read of a board may take; it is tried once more, so the page offers Try again after about 20
 * seconds rather than showing its shape for ever (a read that never answered, browser review, 2 November 2026). */
export const boardReadPatience = Duration.seconds(10)

/** A board read that gives up after its patience, tried twice. */
export const patiently = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  read.pipe(
    Effect.timeout(boardReadPatience),
    Effect.retry({ times: 1, while: (error) => Predicate.isTagged(error, 'TimeoutError') }),
  )

/** A board as others see it, once it is public and Styld's check lets them. */
const visitBoard = (boardId: string) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const board = yield* patiently(api.public.board({ params: { boardId: yield* boardIdOf(boardId) } }))
    return Message.SucceededVisitBoard({ board })
  }).pipe(
    Effect.catchTag('NotFound', () => Effect.succeed(Message.FailedLoadBoard({ error: 'NotFound' }))),
    Effect.orElseSucceed(() => Message.FailedLoadBoard({ error: 'Unavailable' })),
  )

export const LoadBoard = Command.define('LoadBoard', {
  args: { boardId: Schema.String },
  messages: [Message.SucceededLoadBoard, Message.FailedLoadBoard, Message.SucceededVisitBoard],
  execute: ({ boardId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* patiently(api.board.getBoard({ params: { boardId: yield* boardIdOf(boardId) } }))
      return Message.SucceededLoadBoard({ board })
    }).pipe(
      Effect.catchTag('SchemaError', () => Effect.succeed(Message.FailedLoadBoard({ error: 'NotFound' }))),
      Effect.catchTag(['Unavailable', 'TimeoutError'], () =>
        Effect.succeed(Message.FailedLoadBoard({ error: 'Unavailable' })),
      ),
      // Not this account's board, or nobody signed in: it may be public.
      Effect.catch(() => visitBoard(boardId)),
    ),
})

/** Signed out, a board can only be someone else's public one: read it as visitors do. */
export const VisitBoard = Command.define('VisitBoard', {
  args: { boardId: Schema.String },
  messages: [Message.SucceededVisitBoard, Message.FailedLoadBoard],
  execute: ({ boardId }) => visitBoard(boardId),
})

/** Fresh item ids: 16 random bytes each, like every Styld id. */
export const MakeIds = Command.define('MakeIds', {
  messages: [Message.CompletedMakeIds],
  execute: Effect.gen(function* () {
    const random = yield* SecureRandom.SecureRandom
    const ids = yield* Effect.forEach(
      Array.makeBy(12, () => undefined),
      () =>
        random
          .randomBytes(16)
          .pipe(Effect.flatMap((bytes) => Schema.decodeUnknownEffect(BoardItemId)(`bi_${Base64Url.encode(bytes)}`))),
    )
    return Message.CompletedMakeIds({ ids })
  }).pipe(Effect.orDie),
})

export const WaitToSave = Command.define('WaitToSave', {
  args: { generation: Schema.Int },
  messages: [Message.ElapsedSaveWait],
  execute: ({ generation }) => Effect.sleep(saveWait).pipe(Effect.as(Message.ElapsedSaveWait({ generation }))),
})

/** Save the whole table from the version it started with. A newer save elsewhere wins: the editor shows it. */
export const SaveItems = Command.define('SaveItems', {
  args: { boardId: Schema.String, version: Schema.Int, items: Schema.Array(BoardItem) },
  messages: [Message.SucceededSaveItems, Message.ReplacedByNewerBoard, Message.FailedSaveItems],
  execute: ({ boardId, version, items }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const id = yield* boardIdOf(boardId)
      const operationId = yield* drawOperationId()
      const current = api.board
        .getBoard({ params: { boardId: id } })
        .pipe(Effect.map((board) => Message.ReplacedByNewerBoard({ board })))
      return yield* api.board
        .saveBoardItems({ params: { boardId: id }, payload: { operationId, version, items } })
        .pipe(
          Effect.map((board) => Message.SucceededSaveItems({ board })),
          // Saved elsewhere first, or a piece on the table left the wardrobe: show the board as it is now.
          Effect.catchTags({ BoardVersionConflict: () => current, BoardItemRefused: () => current }),
        )
    }).pipe(Effect.orElseSucceed(() => Message.FailedSaveItems())),
})

/** Save the board's paper; `previous` is the one it replaced, which comes back if this fails. */
export const UpdatePaper = Command.define('UpdatePaper', {
  args: { boardId: Schema.String, paper: Paper, previous: Paper },
  messages: [Message.SucceededUpdatePaper, Message.FailedUpdatePaper],
  execute: ({ boardId, paper, previous }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.updateBoard({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: { operationId: yield* drawOperationId(), paper },
      })
      return Message.SucceededUpdatePaper({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedUpdatePaper({ attempted: paper, previous }))),
})

export const WaitForExit = Command.define('WaitForExit', {
  args: { id: Schema.String },
  messages: [Message.CompletedExit],
  execute: ({ id }) => Effect.sleep(exitDuration).pipe(Effect.as(Message.CompletedExit({ id }))),
})

export const WaitForToast = Command.define('WaitForToast', {
  args: { generation: Schema.Int },
  messages: [Message.ElapsedToast],
  execute: ({ generation }) => Effect.sleep(toastDuration).pipe(Effect.as(Message.ElapsedToast({ generation }))),
})

/** Send one picture and put it on the board: upload its bytes, then claim the upload for the board. */
export const AddImage = Command.define('AddImage', {
  args: { boardId: Schema.String, file: File.File },
  messages: [Message.SucceededAddImage, Message.FailedAddImage],
  execute: ({ boardId, file }) =>
    Effect.gen(function* () {
      const uploadId = yield* uploadPicture(file)
      const api = yield* (yield* StyldClient).api
      const operationId = yield* drawOperationId()
      const image = yield* api.board.addBoardImage({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: { operationId, uploadId },
      })
      return Message.SucceededAddImage(image)
    }).pipe(
      Effect.catchIf(
        (error) =>
          Predicate.isTagged(error, 'NotAPicture') ||
          Predicate.isTagged(error, 'UploadRefused') ||
          Predicate.isTagged(error, 'FileNotSent'),
        () => Effect.succeed(Message.FailedAddImage({ problem: 'refused' })),
      ),
      Effect.orElseSucceed(() => Message.FailedAddImage({ problem: 'failed' })),
    ),
})

/** Put a Gallery photo's picture (the photo, or the person cut out of it) on the board, pinned only: the page lays it
 * on the table it edits, as it does a picture the person sends. */
export const AddGalleryPicture = Command.define('AddGalleryPicture', {
  args: { boardId: Schema.String, photoId: PhotoId, picture: PhotoPicture },
  messages: [Message.SucceededAddImage, Message.FailedAddImage],
  execute: ({ boardId, photoId, picture }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const image = yield* api.photo.addToBoard({
        params: { photoId },
        payload: {
          operationId: yield* drawOperationId(),
          boardId: yield* boardIdOf(boardId),
          picture,
          placeOnTable: false,
        },
      })
      return Message.SucceededAddImage(image)
    }).pipe(Effect.orElseSucceed(() => Message.FailedAddImage({ problem: 'failed' }))),
})

/** Put a try-on's picture on the board, pinned only, for the page to lay on its table. */
export const AddTryOnPicture = Command.define('AddTryOnPicture', {
  args: { boardId: Schema.String, tryOnId: TryOnId },
  messages: [Message.SucceededAddImage, Message.FailedAddImage],
  execute: ({ boardId, tryOnId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const image = yield* api.tryOn.addTryOnToBoard({
        params: { tryOnId },
        payload: { operationId: yield* drawOperationId(), boardId: yield* boardIdOf(boardId) },
      })
      return Message.SucceededAddImage(image)
    }).pipe(Effect.orElseSucceed(() => Message.FailedAddImage({ problem: 'failed' }))),
})

/** The pictures on the clipboard, read when the person taps Paste (the only way a phone's browser shares
 * them). The browser asks for permission first. */
export const ReadClipboard = Command.define('ReadClipboard', {
  messages: [Message.CompletedReadClipboard],
  execute: Effect.tryPromise({
    try: async () => {
      const items = await navigator.clipboard.read()
      const blobs = await Promise.all(
        items.flatMap((item) =>
          item.types.filter((type) => type.startsWith('image/')).map((type) => item.getType(type)),
        ),
      )
      return blobs.map((blob, index) => new globalThis.File([blob], `pasted-${index}`, { type: blob.type }))
    },
    catch: () => 'ClipboardRefused' as const,
  }).pipe(
    Effect.map((files) => Message.CompletedReadClipboard({ files })),
    Effect.orElseSucceed(() => Message.CompletedReadClipboard({ files: [] })),
  ),
})

/** Pieces of the board, from the top of the stack down, become a look named after the board, pinned on it (T-16). */
export const SaveLook = Command.define('SaveLook', {
  args: { boardId: Schema.String, name: Schema.String, pieceIds: Schema.Array(PieceId) },
  messages: [Message.SucceededSaveLook, Message.FailedSaveLook],
  execute: ({ boardId, name, pieceIds }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const operationId = yield* drawOperationId()
      const { look, board } = yield* api.board.keepLook({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: { operationId, name, pieceIds },
      })
      return Message.SucceededSaveLook({ lookId: look.id, board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSaveLook())),
})

// MOUNT

/** Reports the paper's width whenever it changes, so pointer travel in pixels converts to table units. */
export const MeasurePaper = Mount.defineStream('MeasurePaper', {
  messages: [Message.MeasuredPaper],
  execute: ({ element }) =>
    observed<typeof Message.MeasuredPaper.Type>(
      element,
      (offer) =>
        new ResizeObserver((entries) => {
          const width = Option.fromNullishOr(entries[0]?.contentRect.width)
          if (Option.isSome(width) && width.value > 0) {
            offer(Message.MeasuredPaper({ width: width.value }))
          }
        }),
    ),
})

/** Table units per page pixel, from the paper's measured width. */
export const unitsPerPixel = (width: number) => width / boardWidth
