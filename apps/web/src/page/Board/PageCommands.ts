import { drawOperationId } from '../../OperationIds.ts'
import { BoardId, BoardName, LookId, Mood, PinId } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { Command, Dom } from 'foldkit'
import { load as loadPage } from 'foldkit/navigation'
import { boardsRouter } from '../../route.ts'
import { StyldClient } from '../../StyldClient.ts'
import { patiently } from './Commands.ts'
import { Message } from './Message.ts'

// COMMAND

// The board page's Commands: its settings, its pins and the looks its picker offers. The table's own are in
// Commands.ts.

const boardIdOf = (id: string) => Schema.decodeUnknownEffect(BoardId)(id)
/** The board as it is now, read again when the page comes back into view; none when it could not be read, and the
 * page keeps what it shows. */
export const ReloadBoard = Command.define('ReloadBoard', {
  args: { boardId: Schema.String },
  messages: [Message.CompletedReloadBoard],
  execute: ({ boardId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* patiently(api.board.getBoard({ params: { boardId: yield* boardIdOf(boardId) } }))
      return Message.CompletedReloadBoard({ maybeBoard: Option.some(board) })
    }).pipe(Effect.orElseSucceed(() => Message.CompletedReloadBoard({ maybeBoard: Option.none() }))),
})

export const RenameBoard = Command.define('RenameBoard', {
  args: { boardId: Schema.String, name: Schema.String },
  messages: [Message.SucceededRename, Message.FailedRename],
  execute: ({ boardId, name }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.updateBoard({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: { operationId: yield* drawOperationId(), name: yield* Schema.decodeUnknownEffect(BoardName)(name) },
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
        payload: { operationId: yield* drawOperationId(), visibility: isPublic ? 'public' : 'private' },
      })
      return Message.SucceededSetVisibility({ board })
    }).pipe(
      Effect.catchTag('ProfileNotPublished', () => Effect.succeed(Message.FailedSetVisibility({ needsProfile: true }))),
      Effect.orElseSucceed(() => Message.FailedSetVisibility({ needsProfile: false })),
    ),
})

/** Save the board's moods for Explore; the previous ones come back if this fails. */
export const SetBoardMoods = Command.define('SetBoardMoods', {
  args: { boardId: Schema.String, moods: Schema.Array(Mood), previous: Schema.Array(Mood) },
  messages: [Message.SucceededSetBoardMoods, Message.FailedSetBoardMoods],
  execute: ({ boardId, moods, previous }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.updateBoard({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: { operationId: yield* drawOperationId(), moods },
      })
      return Message.SucceededSetBoardMoods({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSetBoardMoods({ attempted: moods, previous }))),
})

/** Delete the board; one already gone counts as deleted. */
export const DeleteBoard = Command.define('DeleteBoard', {
  args: { boardId: Schema.String },
  messages: [Message.SucceededDeleteBoard, Message.FailedDeleteBoard],
  execute: ({ boardId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      yield* api.board.deleteBoard({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: { operationId: yield* drawOperationId() },
      })
      return Message.SucceededDeleteBoard()
    }).pipe(
      Effect.catchTag('NotFound', () => Effect.succeed(Message.SucceededDeleteBoard())),
      Effect.orElseSucceed(() => Message.FailedDeleteBoard()),
    ),
})

/** Back to the boards, once this one is deleted. */
export const LeaveBoard = Command.define('LeaveBoard', {
  messages: [Message.CompletedLeaveBoard],
  execute: loadPage(boardsRouter({})).pipe(Effect.as(Message.CompletedLeaveBoard())),
})

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
          operationId: yield* drawOperationId(),
          pinIds: yield* Schema.decodeUnknownEffect(Schema.Array(PinId))(pinIds),
        },
      })
      return Message.SucceededPins({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedPins())),
})

/** Pin a look the person put on the table from the Add sheet: pinned only, the table being the page's to save. A pin
 * that does not go through leaves the table as it is. */
export const PinLook = Command.define('PinLook', {
  args: { boardId: Schema.String, lookId: Schema.String },
  messages: [Message.CompletedPinLook],
  execute: ({ boardId, lookId }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const board = yield* api.board.addPins({
        params: { boardId: yield* boardIdOf(boardId) },
        payload: {
          operationId: yield* drawOperationId(),
          lookIds: [yield* Schema.decodeUnknownEffect(LookId)(lookId)],
        },
      })
      return Message.CompletedPinLook({ maybeBoard: Option.some(board) })
    }).pipe(Effect.orElseSucceed(() => Message.CompletedPinLook({ maybeBoard: Option.none() }))),
})

/** The person's Gallery photos, for the Add sheet. */
export const LoadPhotos = Command.define('LoadPhotos', {
  messages: [Message.SucceededLoadPhotos, Message.FailedLoadPhotos],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { photos } = yield* api.photo.listPhotos()
    return Message.SucceededLoadPhotos({ photos })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadPhotos())),
})

/** The person's try-ons, for the Add sheet. */
export const LoadTryOns = Command.define('LoadTryOns', {
  messages: [Message.SucceededLoadTryOns, Message.FailedLoadTryOns],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { tryOns } = yield* api.tryOn.listTryOns()
    return Message.SucceededLoadTryOns({ tryOns })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadTryOns())),
})

/** The person's looks, for the Add sheet. */
export const LoadLooks = Command.define('LoadLooks', {
  messages: [Message.SucceededLoadLooks, Message.FailedLoadLooks],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { looks } = yield* api.look.listLooks()
    return Message.SucceededLoadLooks({ looks })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadLooks())),
})
