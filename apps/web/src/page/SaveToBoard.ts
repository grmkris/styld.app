import { newOperationId } from '../OperationIds.ts'
import { Dialog } from '@foldkit/ui'
import { BoardId, BoardName, BoardSummary, LookId, PhotoId, PieceId } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from './Sheet.ts'
import { StyldClient } from '../StyldClient.ts'
import { boardSummaries } from './Boards.ts'

// "Save to board" from a piece or a look of the person's own: a sheet of their boards, and a new one by name.

// MODEL

/** What is being saved. */
/** What is saved: a piece or a look as a pin, or an outfit photo of My Gallery, put on the board with its look and
 * shown to its owner only. */
export const Target = Schema.Struct({ kind: Schema.Literals(['piece', 'look', 'photo']), id: Schema.String })
export type Target = typeof Target.Type

const BoardsData = AsyncData.Schema(Schema.Array(BoardSummary), Schema.Literal('Unavailable'))

export const Saving = defineTaggedUnion({
  Idle: {},
  Sending: {},
  Saved: { boardId: Schema.String, boardName: Schema.String },
  Failed: {},
})
export type Saving = typeof Saving.Type

export const Model = Schema.Struct({
  target: Target,
  sheet: Dialog.Model,
  boards: BoardsData.schema,
  name: Schema.String,
  saving: Saving,
})
export type Model = typeof Model.Type

export const init = (target: Target): Model => ({
  target,
  sheet: Dialog.init({ id: `save-to-board-${target.kind}`, isAnimated: true }),
  boards: AsyncData.Idle(),
  name: '',
  saving: Saving.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedSave: {},
  GotSheetMessage: { message: Dialog.Message },
  SucceededListBoards: { boards: Schema.Array(BoardSummary) },
  FailedListBoards: {},
  ClickedRetry: {},
  ClickedBoard: { boardId: Schema.String, boardName: Schema.String },
  UpdatedName: { value: Schema.String },
  SubmittedNewBoard: {},
  SucceededSave: { boardId: Schema.String, boardName: Schema.String },
  FailedSave: {},
})
export type Message = typeof Message.Type

// COMMAND

const pinsOf = (target: Target) =>
  target.kind === 'piece'
    ? Effect.map(Schema.decodeUnknownEffect(PieceId)(target.id), (pieceId) => ({ pieceIds: [pieceId] }))
    : Effect.map(Schema.decodeUnknownEffect(LookId)(target.id), (lookId) => ({ lookIds: [lookId] }))

export const ListBoardsToSaveTo = Command.define('ListBoardsToSaveTo', {
  messages: [Message.SucceededListBoards, Message.FailedListBoards],
  execute: Effect.match(boardSummaries, {
    onFailure: () => Message.FailedListBoards(),
    onSuccess: (boards) => Message.SucceededListBoards({ boards }),
  }),
})

/** Pin the target on a board, a new one first when it has only a name.
 */
export const SaveTo = Command.define('SaveTo', {
  args: { target: Target, boardId: Schema.Option(Schema.String), boardName: Schema.String },
  messages: [Message.SucceededSave, Message.FailedSave],
  execute: ({ target, boardId, boardName }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const id = Option.isSome(boardId)
        ? yield* Schema.decodeUnknownEffect(BoardId)(boardId.value)
        : (yield* api.board.createBoard({
            payload: {
              operationId: yield* newOperationId,
              name: yield* Schema.decodeUnknownEffect(BoardName)(boardName),
            },
          })).id
      const operationId = yield* newOperationId
      if (target.kind === 'photo')
        yield* api.photo.addToBoard({
          params: { photoId: yield* Schema.decodeUnknownEffect(PhotoId)(target.id) },
          payload: { operationId, boardId: id },
        })
      else yield* api.board.addPins({ params: { boardId: id }, payload: { operationId, ...(yield* pinsOf(target)) } })
      return Message.SucceededSave({ boardId: id, boardName })
    }).pipe(Effect.orElseSucceed(() => Message.FailedSave())),
})

// UPDATE

type Services = StyldClient | Crypto.Crypto
type UpdateReturn = Update.Return<Model, Message, Services>

const sheet = sheetFolds<Model, Message>({
  read: (model) => model.sheet,
  write: (model, nextSheet) => modifyFields(model, { sheet: () => nextSheet }),
  toParentMessage: (message) => Message.GotSheetMessage({ message }),
})
const foldSheet = sheet.update
const openSheet = sheet.open

/** The sheet opens fresh, and reads the boards again so a board made meanwhile is there. */
const opened = (model: Model): UpdateReturn => {
  const next = openSheet(modifyFields(model, { name: () => '', saving: () => Saving.Idle() }))
  return {
    ...next,
    model: modifyFields(next.model, { boards: (boards) => (AsyncData.hasData(boards) ? boards : AsyncData.Loading()) }),
    commands: [...(next.commands ?? []), ListBoardsToSaveTo()],
  }
}

const sent = (model: Model, boardId: Option.Option<string>, boardName: string): UpdateReturn => ({
  model: modifyFields(model, { saving: () => Saving.Sending() }),
  commands: [SaveTo({ target: model.target, boardId, boardName })],
})

/** "Save to board" inside a page whose model keeps it as `saveToBoard`. */
export const foldInto = <Parent extends { readonly saveToBoard: Model }, ParentMessage>(
  toParentMessage: (message: Message) => ParentMessage,
) =>
  Update.foldChild({
    update: (model: Model, message: Message) => update(model, message),
    read: (parent: Parent) => Option.some(parent.saveToBoard),
    write: (parent: Parent, saveToBoard: Model): Parent => ({ ...parent, saveToBoard }),
    toParentMessage,
  })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedSave: () => opened(model),
    GotSheetMessage: (got) => foldSheet(model, got.message),
    SucceededListBoards: ({ boards }) => ({
      model: modifyFields(model, { boards: () => BoardsData.Success({ data: boards }) }),
    }),
    FailedListBoards: () => ({
      model: modifyFields(model, { boards: () => BoardsData.Failure({ error: 'Unavailable' }) }),
    }),
    ClickedRetry: () => ({
      model: modifyFields(model, { boards: () => AsyncData.Loading() }),
      commands: [ListBoardsToSaveTo()],
    }),
    ClickedBoard: ({ boardId, boardName }) => sent(model, Option.some(boardId), boardName),
    UpdatedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
    SubmittedNewBoard: () => {
      const name = model.name.trim()
      return name.length === 0 ? { model } : sent(model, Option.none(), name)
    },
    SucceededSave: ({ boardId, boardName }) => ({
      model: modifyFields(model, { saving: () => Saving.Saved({ boardId, boardName }), name: () => '' }),
    }),
    FailedSave: () => ({ model: modifyFields(model, { saving: () => Saving.Failed() }) }),
  })
