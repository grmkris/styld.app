import { newOperationId } from '../OperationIds.ts'
import { Board, BoardName, SavedThing } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** What the person saved from others, newest first. */
export const SavedData = AsyncData.Schema(Schema.Array(SavedThing), Schema.Literal('Unavailable'))
export type SavedData = typeof SavedData.schema.Type

export const Creating = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })
export type Creating = typeof Creating.Type

/** The Boards page: making a board and what the person saved from others. The boards themselves are the app's
 * (ServerData), which Save to board and Home read too. */
export const Model = Schema.Struct({
  creating: Creating,
  saved: SavedData.schema,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  creating: Creating.Idle(),
  saved: AsyncData.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedRetry: {},
  ClickedNewBoard: { defaultName: Schema.String },
  SucceededCreateBoard: { board: Board },
  FailedCreateBoard: {},
  SucceededListSaved: { saved: Schema.Array(SavedThing) },
  FailedListSaved: {},
})
export type Message = typeof Message.Type

/** A new board opens straight away, under the default name; its page renames it. The boards that did not load are
 * asked for again by the app. */
export const OutMessage = defineMessageUnion({ CreatedBoard: { boardId: Schema.String }, RequestedBoards: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const ListSaved = Command.define('ListSaved', {
  messages: [Message.SucceededListSaved, Message.FailedListSaved],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededListSaved({ saved: (yield* api.social.listSaved()).saved })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListSaved())),
})

export const CreateBoard = Command.define('CreateBoard', {
  args: { name: Schema.String },
  messages: [Message.SucceededCreateBoard, Message.FailedCreateBoard],
  execute: ({ name }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const operationId = yield* newOperationId
      const board = yield* api.board.createBoard({
        payload: { operationId, name: yield* Schema.decodeUnknownEffect(BoardName)(name) },
      })
      return Message.SucceededCreateBoard({ board })
    }).pipe(Effect.orElseSucceed(() => Message.FailedCreateBoard())),
})

// UPDATE

type Services = StyldClient | Crypto.Crypto
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const refreshSaved = Update.refresh<Model, Message, ReadonlyArray<SavedThing>, 'Unavailable', StyldClient>({
  read: (model: Model) => Option.some(model.saved),
  revalidate: AsyncData.revalidateOrLoad,
  write: (model: Model, saved: SavedData) => modifyFields(model, { saved: () => saved }),
  load: ListSaved(),
})

/** Opening the page: the saves already here stay while they are asked for again; a first visit asks. The app reads
 * the boards. */
export const revisit = refreshSaved

/** A board made opens its own page, which loads whole; the list reads it from then on. */
const created = (model: Model, board: Board): UpdateReturn => ({
  model: modifyFields(model, { creating: () => Creating.Idle() }),
  outMessage: OutMessage.CreatedBoard({ boardId: board.id }),
})

/** Make a board under the default name; once made it opens (`CreatedBoard`). Ask's + sheet starts one this way too. */
export const startBoard =
  (defaultName: string) =>
  (model: Model): UpdateReturn =>
    Creating.guards.Sending(model.creating)
      ? { model }
      : {
          model: modifyFields(model, { creating: () => Creating.Sending() }),
          commands: [CreateBoard({ name: defaultName })],
        }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedBoards() }),
    SucceededListSaved: ({ saved }) => ({
      model: modifyFields(model, { saved: () => SavedData.Success({ data: saved }) }),
    }),
    FailedListSaved: () => ({
      model: modifyFields(model, { saved: (saved) => AsyncData.settle(saved, Result.fail('Unavailable' as const)) }),
    }),
    ClickedNewBoard: ({ defaultName }) => startBoard(defaultName)(model),
    SucceededCreateBoard: ({ board }) => created(model, board),
    FailedCreateBoard: () => ({ model: modifyFields(model, { creating: () => Creating.Failed() }) }),
  })
