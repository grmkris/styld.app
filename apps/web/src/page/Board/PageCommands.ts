import { drawOperationId } from '../../OperationIds.ts'
import { BoardId, LookId, Paper, PinId } from '@styld/protocol'
import { Duration, Effect, Option, Predicate, Schema } from 'effect'
import { Command } from 'foldkit'
import { StyldClient } from '../../StyldClient.ts'
import { Message } from './Message.ts'

// COMMAND

// The board page's Commands around its table: reading the board, its paper and its pins. The table's own are in
// Commands.ts, the chrome's in Chrome.ts and the Add sheet's in AddSheet.ts.

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
