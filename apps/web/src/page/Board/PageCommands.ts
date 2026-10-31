import { BoardId, BoardName, LookId, Mood, OperationId, PieceId, PinId } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, Dom } from 'foldkit'
import { load as loadPage } from 'foldkit/navigation'
import { boardsRouter } from '../../route.ts'
import { StyldClient } from '../../StyldClient.ts'
import { Message } from './Message.ts'

// COMMAND

// The board page's Commands: its settings, its pins and the looks its picker offers. The table's own are in
// Commands.ts.

const boardIdOf = (id: string) => Schema.decodeUnknownEffect(BoardId)(id)
const newOperationId = Effect.gen(function* () {
  return yield* Schema.decodeUnknownEffect(OperationId)(yield* (yield* Crypto.Crypto).randomUUIDv4())
})

/** The board as it is now, read again when the page comes back into view. */
export const ReloadBoard = Command.define('ReloadBoard', {
  args: { boardId: Schema.String },
  messages: [Message.SucceededReloadBoard, Message.FailedReloadBoard],
  execute: ({ boardId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.getBoard({ params: { boardId: yield* boardIdOf(boardId) } })
      return Message.SucceededReloadBoard({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedReloadBoard())),
})

export const RenameBoard = Command.define('RenameBoard', {
  args: { boardId: Schema.String, name: Schema.String },
  messages: [Message.SucceededRename, Message.FailedRename],
  execute: ({ boardId, name }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.updateBoard({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: { name: yield* Schema.decodeUnknownEffect(BoardName)(name) },
      })
      return Message.SucceededRename({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedRename())),
})

/** Make the board public on the person's profile, or private again. */
export const SetBoardVisibility = Command.define('SetBoardVisibility', {
  args: { boardId: Schema.String, isPublic: Schema.Boolean },
  messages: [Message.SucceededSetVisibility, Message.FailedSetVisibility],
  execute: ({ boardId, isPublic }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.setBoardVisibility({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: { visibility: isPublic ? 'public' : 'private' },
      })
      return Message.SucceededSetVisibility({ board })
    }).pipe(
      Effect.catchTag('ProfileNotPublished', () => Effect.succeed(Message.FailedSetVisibility({ needsProfile: true }))),
      Effect.orElseSucceed(() => Message.FailedSetVisibility({ needsProfile: false })),
    ),
})

/** Save the board's moods for Explore. */
export const SetBoardMoods = Command.define('SetBoardMoods', {
  args: { boardId: Schema.String, moods: Schema.Array(Mood) },
  messages: [Message.SucceededSetMoods, Message.FailedSetMoods],
  execute: ({ boardId, moods }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.updateBoard({ params: { boardId: yield* boardIdOf(boardId) }, payload: { moods } })
      return Message.SucceededSetMoods({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSetMoods())),
})

/** Delete the board; one already gone counts as deleted. */
export const DeleteBoard = Command.define('DeleteBoard', {
  args: { boardId: Schema.String },
  messages: [Message.SucceededDeleteBoard, Message.FailedDeleteBoard],
  execute: ({ boardId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.board.deleteBoard({ params: { boardId: yield* boardIdOf(boardId) } })
      return Message.SucceededDeleteBoard()
    }).pipe(
      Effect.catchTag('BoardNotFound', () => Effect.succeed(Message.SucceededDeleteBoard())),
      Effect.orElseSucceed(() => Message.FailedDeleteBoard()),
    ),
})

/** Back to the boards, once this one is deleted. */
export const LeaveBoard = Command.define('LeaveBoard', {
  messages: [Message.CompletedLeaveBoard],
  execute: loadPage(boardsRouter({})).pipe(Effect.as(Message.CompletedLeaveBoard())),
})

export const PinThings = Command.define('PinThings', {
  args: { boardId: Schema.String, pieceIds: Schema.Array(Schema.String), lookIds: Schema.Array(Schema.String) },
  messages: [Message.SucceededPins, Message.FailedPins],
  execute: ({ boardId, pieceIds, lookIds }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.addPins({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: {
          operationId: yield* newOperationId,
          pieceIds: yield* Schema.decodeUnknownEffect(Schema.Array(PieceId))(pieceIds),
          lookIds: yield* Schema.decodeUnknownEffect(Schema.Array(LookId))(lookIds),
        },
      })
      return Message.SucceededPins({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedPins())),
})

/** How many of the board's pins others see: the public page, read as a visitor reads it, is the one rule for that.
 * A board others cannot see yet (its check is out, or it hid) shows them none. */
export const ReadShown = Command.define('ReadShown', {
  args: { boardId: Schema.String },
  messages: [Message.SucceededReadShown, Message.FailedReadShown],
  execute: ({ boardId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.public.board({ params: { boardId: yield* boardIdOf(boardId) } })
      return Message.SucceededReadShown({ count: board.pins.length })
    }).pipe(
      Effect.catchTag('PublicNotFound', () => Effect.succeed(Message.SucceededReadShown({ count: 0 }))),
      Effect.orElseSucceed(() => Message.FailedReadShown()),
    ),
})

/** Reads what others see once the board is public; private, there is nothing to read. */
export const readShown = (model: { readonly boardId: string; readonly visibility: string }) =>
  model.visibility === 'public' ? [ReadShown({ boardId: model.boardId })] : []

/** The unpin question's Keep takes focus as it opens, and the × takes it back when the pin stays. */
export const FocusPin = Command.define('FocusPin', {
  args: { selector: Schema.String },
  messages: [Message.CompletedFocusPin],
  execute: ({ selector }) => Dom.focus(selector).pipe(Effect.ignore, Effect.as(Message.CompletedFocusPin())),
})

/** The ids the pin's × and its Keep carry, so focus can move between them. */
export const unpinId = (pinId: string) => `unpin-${pinId}`
export const keepPinId = (pinId: string) => `keep-${pinId}`

export const UnpinThings = Command.define('UnpinThings', {
  args: { boardId: Schema.String, pinIds: Schema.Array(Schema.String) },
  messages: [Message.SucceededPins, Message.FailedPins],
  execute: ({ boardId, pinIds }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.removePins({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: {
          operationId: yield* newOperationId,
          pinIds: yield* Schema.decodeUnknownEffect(Schema.Array(PinId))(pinIds),
        },
      })
      return Message.SucceededPins({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedPins())),
})

/** The person's looks, for the picker. */
export const LoadLooks = Command.define('LoadLooks', {
  messages: [Message.SucceededLoadLooks, Message.FailedLoadLooks],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { looks } = yield* api.look.listLooks()
    return Message.SucceededLoadLooks({ looks })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadLooks())),
})
