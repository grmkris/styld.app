import { newOperationId } from '../OperationIds.ts'
import { Board, BoardName, BoardSummary, SavedThing } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** The person's boards as last read, kept on screen while they are asked for again. */
export const BoardsData = AsyncData.Schema(Schema.Array(BoardSummary), Schema.Literal('Unavailable'))
export type BoardsData = typeof BoardsData.schema.Type

/** What the person saved from others, newest first. */
export const SavedData = AsyncData.Schema(Schema.Array(SavedThing), Schema.Literal('Unavailable'))
export type SavedData = typeof SavedData.schema.Type

export const Creating = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })
export type Creating = typeof Creating.Type

export const Model = Schema.Struct({
  boards: BoardsData.schema,
  creating: Creating,
  saved: SavedData.schema,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  boards: AsyncData.Idle(),
  creating: Creating.Idle(),
  saved: AsyncData.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededListBoards: { boards: Schema.Array(BoardSummary) },
  FailedListBoards: {},
  ClickedRetry: {},
  ClickedNewBoard: { defaultName: Schema.String },
  SucceededCreateBoard: { board: Board },
  FailedCreateBoard: {},
  SucceededListSaved: { saved: Schema.Array(SavedThing) },
  FailedListSaved: {},
})
export type Message = typeof Message.Type

/** A new board opens straight away, under the default name; its page renames it. */
export const OutMessage = defineMessageUnion({ CreatedBoard: { boardId: Schema.String } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** The person's boards, as their list shows them. */
export const boardSummaries = Effect.gen(function* () {
  const api = yield* (yield* StyldClient).api
  return (yield* api.board.listBoards()).boards
})

/** @internal Exported for its tests. */
export const ListBoards = Command.define('ListBoards', {
  messages: [Message.SucceededListBoards, Message.FailedListBoards],
  execute: boardSummaries.pipe(
    Effect.map((boards) => Message.SucceededListBoards({ boards })),
    Effect.orElseSucceed(() => Message.FailedListBoards()),
  ),
})

const ListSaved = Command.define('ListSaved', {
  messages: [Message.SucceededListSaved, Message.FailedListSaved],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededListSaved({ saved: (yield* api.social.listSaved()).saved })
  }).pipe(Effect.orElseSucceed(() => Message.FailedListSaved())),
})

/** @internal Exported for its tests. */
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

const refreshBoards = Update.refresh<Model, Message, ReadonlyArray<BoardSummary>, 'Unavailable', StyldClient>({
  read: (model: Model) => Option.some(model.boards),
  revalidate: AsyncData.revalidateOrLoad,
  write: (model: Model, boards: BoardsData) => modifyFields(model, { boards: () => boards }),
  load: ListBoards(),
})

const refreshSaved = Update.refresh<Model, Message, ReadonlyArray<SavedThing>, 'Unavailable', StyldClient>({
  read: (model: Model) => Option.some(model.saved),
  revalidate: AsyncData.revalidateOrLoad,
  write: (model: Model, saved: SavedData) => modifyFields(model, { saved: () => saved }),
  load: ListSaved(),
})

/** Opening the page: the boards and saves already here stay while they are asked for again; a first visit asks. */
export const revisit = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Update.combine<Model, Message, StyldClient>(model, [refreshBoards, refreshSaved])

/** A board as its list shows it: its table, its newest pins and how many. */
const summaryOf = (board: Board): BoardSummary => ({
  id: board.id,
  name: board.name,
  paper: board.paper,
  items: board.items,
  cover: board.pins.slice(0, 4),
  pinCount: board.pins.length,
  visibility: board.visibility,
  updatedAt: board.updatedAt,
})

const created = (model: Model, board: Board): UpdateReturn => ({
  model: modifyFields(model, {
    creating: () => Creating.Idle(),
    boards: (boards) => AsyncData.map(boards, (list) => [summaryOf(board), ...list]),
  }),
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
    SucceededListBoards: ({ boards }) => ({
      model: modifyFields(model, { boards: () => BoardsData.Success({ data: boards }) }),
    }),
    FailedListBoards: () => ({
      model: modifyFields(model, { boards: (boards) => AsyncData.settle(boards, Result.fail('Unavailable' as const)) }),
    }),
    ClickedRetry: () => refreshBoards(model),
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
