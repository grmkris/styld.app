import { Board, BoardName, OperationId } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

export const BoardList = defineTaggedUnion({
  Loading: {},
  Loaded: { boards: Schema.Array(Board) },
  Failed: {},
})
export type BoardList = typeof BoardList.Type

export const Creating = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })

export const Model = Schema.Struct({
  boards: BoardList,
  /** The new board's name as typed; empty means the default name. */
  name: Schema.String,
  creating: Creating,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ boards: BoardList.Loading(), name: '', creating: Creating.Idle() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListBoards: { boards: Schema.Array(Board) },
  FailedListBoards: {},
  ClickedRetry: {},
  UpdatedName: { value: Schema.String },
  SubmittedNewBoard: { defaultName: Schema.String },
  SucceededCreateBoard: { board: Board },
  FailedCreateBoard: {},
})
export type Message = typeof Message.Type

/** A new board opens straight away. */
export const OutMessage = defineMessageUnion({ CreatedBoard: { boardId: Schema.String } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** @internal Exported for its tests. */
export const ListBoards = Command.define('ListBoards', {
  messages: [Message.SucceededListBoards, Message.FailedListBoards],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    const { boards } = yield* api.board.listBoards()
    return Message.SucceededListBoards({ boards })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListBoards())),
})

/** @internal Exported for its tests. */
export const CreateBoard = Command.define('CreateBoard', {
  args: { name: Schema.String },
  messages: [Message.SucceededCreateBoard, Message.FailedCreateBoard],
  execute: ({ name }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const operationId = yield* Schema.decodeUnknownEffect(OperationId)(yield* (yield* Crypto.Crypto).randomUUIDv4())
      const board = yield* api.board.createBoard({
        payload: { operationId, name: yield* Schema.decodeUnknownEffect(BoardName)(name) },
      })
      return Message.SucceededCreateBoard({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedCreateBoard())),
})

export const load = () => [ListBoards()]

// UPDATE

type Services = StyldClient | Crypto.Crypto
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const created = (model: Model, board: Board): UpdateReturn => ({
  model: modifyFields(model, {
    creating: () => Creating.Idle(),
    name: () => '',
    boards: (boards) =>
      BoardList.guards.Loaded(boards) ? BoardList.Loaded({ boards: [board, ...boards.boards] }) : boards,
  }),
  outMessage: OutMessage.CreatedBoard({ boardId: board.id }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededListBoards: ({ boards }) => ({
      model: modifyFields(model, { boards: () => BoardList.Loaded({ boards }) }),
    }),
    FailedListBoards: () => ({ model: modifyFields(model, { boards: () => BoardList.Failed() }) }),
    ClickedRetry: () => ({
      model: modifyFields(model, { boards: () => BoardList.Loading() }),
      commands: [ListBoards()],
    }),
    UpdatedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
    SubmittedNewBoard: ({ defaultName }) =>
      Creating.guards.Sending(model.creating)
        ? { model }
        : {
            model: modifyFields(model, { creating: () => Creating.Sending() }),
            commands: [CreateBoard({ name: model.name.trim().length > 0 ? model.name.trim() : defaultName })],
          },
    SucceededCreateBoard: ({ board }) => created(model, board),
    FailedCreateBoard: () => ({ model: modifyFields(model, { creating: () => Creating.Failed() }) }),
  })
