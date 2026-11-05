import { drawOperationId } from '../../OperationIds.ts'
import { BoardId, LookId, PinId } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { Command } from 'foldkit'
import { StyldClient } from '../../StyldClient.ts'
import { patiently } from './Commands.ts'
import { Message } from './Message.ts'

// COMMAND

// The board page's Commands around its table: reading it again and its pins. The table's own are in Commands.ts, the
// chrome's in Chrome.ts and the Add sheet's in AddSheet.ts.

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
