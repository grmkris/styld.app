import { drawOperationId } from '../OperationIds.ts'
import { Board, BoardName, OperationId, SavedThing } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import * as BoardStart from './BoardStart.ts'

// MODEL

/** What the person saved from others, newest first. */
export const SavedData = AsyncData.Schema(Schema.Array(SavedThing), Schema.Literal('Unavailable'))
export type SavedData = typeof SavedData.schema.Type

export const Creating = defineTaggedUnion({
  Idle: {},
  Sending: {},
  Failed: { operationId: OperationId, name: Schema.String },
})
export type Creating = typeof Creating.Type

/** The Boards page: making a board and what the person saved from others. The boards themselves are the app's
 * (ServerData), which Save to board and Home read too. */
export const Model = Schema.Struct({
  creating: Creating,
  saved: SavedData.schema,
  /** The new-board sheet: Blank, or "One piece, many outfits" (T-10). */
  start: BoardStart.Model,
  /** Ask's Start a board asked for the sheet: it opens once Boards is on screen, since a sheet shown before its page
   * is drawn closes again. */
  startOnEnter: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  creating: Creating.Idle(),
  saved: AsyncData.Idle(),
  start: BoardStart.init(),
  startOnEnter: false,
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedRetry: {},
  ClickedRetrySaved: {},
  ClickedNewBoard: {},
  GotStartMessage: { message: BoardStart.Message },
  SucceededCreateBoard: { board: Board },
  FailedCreateBoard: { operationId: OperationId, name: Schema.String },
  SucceededListSaved: { saved: Schema.Array(SavedThing) },
  FailedListSaved: {},
})
export type Message = typeof Message.Type

/** A new board opens straight away; a blank one under the default name, which its page renames. The boards that did
 * not load, and the pieces a template board is built from, are asked for by the app. */
export const OutMessage = defineMessageUnion({
  CreatedBoard: { boardId: Schema.String },
  RequestedBoards: {},
  RequestedPieces: {},
})
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
  args: { name: Schema.String, maybeOperationId: Schema.Option(OperationId) },
  messages: [Message.SucceededCreateBoard, Message.FailedCreateBoard],
  execute: ({ name, maybeOperationId }) =>
    Effect.gen(function* () {
      const operationId = yield* drawOperationId(maybeOperationId)
      return yield* Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        const board = yield* api.board.createBoard({
          payload: { operationId, name: yield* Schema.decodeUnknownEffect(BoardName)(name) },
        })
        return Message.SucceededCreateBoard({ board })
      }).pipe(Effect.orElseSucceed(() => Message.FailedCreateBoard({ operationId, name })))
    }),
})

// UPDATE

type Services = StyldClient | SecureRandom.SecureRandom
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const refreshSaved = Update.refresh<Model, Message, ReadonlyArray<SavedThing>, 'Unavailable', StyldClient>({
  read: (model: Model) => Option.some(model.saved),
  revalidate: AsyncData.revalidateOrLoad,
  write: (model: Model, saved: SavedData) => modifyFields(model, { saved: () => saved }),
  load: ListSaved(),
})

/** A board made opens its own page, which loads whole; the list reads it from then on. */
const created = (model: Model, board: Board): UpdateReturn => ({
  model: modifyFields(model, { creating: () => Creating.Idle() }),
  outMessage: OutMessage.CreatedBoard({ boardId: board.id }),
})

/** Make a blank board under the default name; once made it opens (`CreatedBoard`). */
export const startBoard =
  (defaultName: string) =>
  (model: Model): UpdateReturn =>
    Creating.guards.Sending(model.creating)
      ? { model }
      : {
          model: modifyFields(model, { creating: () => Creating.Sending() }),
          commands: [
            CreateBoard({
              name: Creating.guards.Failed(model.creating) ? model.creating.name : defaultName,
              maybeOperationId: Creating.guards.Failed(model.creating)
                ? Option.some(model.creating.operationId)
                : Option.none(),
            }),
          ],
        }

const foldStart = Update.foldChild({
  update: BoardStart.update,
  read: (model: Model) => Option.some(model.start),
  write: (model: Model, start: BoardStart.Model) => modifyFields(model, { start: () => start }),
  toParentMessage: (message: BoardStart.Message) => Message.GotStartMessage({ message }),
  foldOutMessage: BoardStart.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
    ChoseBlank:
      ({ defaultName }) =>
      (model) =>
        startBoard(defaultName)(model),
    RequestedPieces: () => (model) => ({ model, outMessage: OutMessage.RequestedPieces() }),
    CreatedBoard:
      ({ boardId }) =>
      (model) => ({ model, outMessage: OutMessage.CreatedBoard({ boardId }) }),
  }),
})

/** Open the new-board sheet (Eva's review, F-26): + on Boards, and Start a board in Ask's sheet. */
export const openStart = Update.foldChildStep({
  update: BoardStart.open,
  read: (model: Model) => Option.some(model.start),
  write: (model: Model, start: BoardStart.Model) => modifyFields(model, { start: () => start }),
  toParentMessage: (message: BoardStart.Message) => Message.GotStartMessage({ message }),
  foldOutMessage: BoardStart.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
    ChoseBlank: () => (model) => ({ model }),
    RequestedPieces: () => (model) => ({ model }),
    CreatedBoard: () => (model) => ({ model }),
  }),
})

/** Ask's Start a board: the sheet opens when Boards is next entered. */
export const startOnEnter = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { startOnEnter: () => true }),
})

/** Opening the page: the saves already here stay while they are asked for again; a first visit asks. The app reads
 * the boards. The new-board sheet opens if Ask asked for it. */
export const revisit = (model: Model): UpdateReturn => {
  const refreshed = refreshSaved(modifyFields(model, { startOnEnter: () => false }))
  if (!model.startOnEnter) return refreshed
  const opened = openStart(refreshed.model)
  return { model: opened.model, commands: [...(refreshed.commands ?? []), ...(opened.commands ?? [])] }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedBoards() }),
    ClickedRetrySaved: () => refreshSaved(model),
    SucceededListSaved: ({ saved }) => ({
      model: modifyFields(model, { saved: () => SavedData.Success({ data: saved }) }),
    }),
    FailedListSaved: () => ({
      model: modifyFields(model, { saved: (saved) => AsyncData.settle(saved, Result.fail('Unavailable' as const)) }),
    }),
    ClickedNewBoard: () => openStart(model),
    GotStartMessage: (got) => foldStart(model, got.message),
    SucceededCreateBoard: ({ board }) => created(model, board),
    FailedCreateBoard: ({ operationId, name }) => ({
      model: modifyFields(model, { creating: () => Creating.Failed({ operationId, name }) }),
    }),
  })
