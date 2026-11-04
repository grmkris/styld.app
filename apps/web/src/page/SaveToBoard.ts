import { drawOperationId } from '../OperationIds.ts'
import { Dialog } from '@foldkit/ui'
import { BoardId, BoardName, LookId, OperationId, PhotoId, PieceId, TryOnId } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from './Sheet.ts'
import { StyldClient } from '../StyldClient.ts'

// "Save to board" from a piece or a look of the person's own: a sheet of their boards, and a new one by name. The
// boards are the app's (ServerData), which the sheet asks for again each time it opens.

// MODEL

/** What is saved: a piece or a look as a pin, an outfit photo of My Gallery or the person cut out of it (whichever
 * its page shows, T-17), put on the board with its look and shown to its owner only, or a try-on's picture. */
export const Target = Schema.Struct({
  kind: Schema.Literals(['piece', 'look', 'photo', 'cutout', 'tryOn']),
  id: Schema.String,
})
export type Target = typeof Target.Type

export const Saving = defineTaggedUnion({
  Idle: {},
  Sending: {},
  Saved: { boardId: Schema.String, boardName: Schema.String },
  Failed: {},
})
export type Saving = typeof Saving.Type

/** Where a save goes: a board the person tapped, or a new board by its name. */
export const Destination = Schema.Struct({ boardId: Schema.Option(Schema.String), boardName: Schema.String })
export type Destination = typeof Destination.Type

/** What a failed save keeps for the next try to the same place: the operation ids it was sent under and the board it
 * made, so trying again resumes it (the server answers a repeated id from its receipt) instead of making a second
 * board. */
export const Resume = Schema.Struct({
  destination: Destination,
  createOperationId: OperationId,
  pinOperationId: OperationId,
  createdBoardId: Schema.Option(Schema.String),
})
export type Resume = typeof Resume.Type

export const Model = Schema.Struct({
  target: Target,
  sheet: Dialog.Model,
  name: Schema.String,
  saving: Saving,
  resume: Schema.Option(Resume),
})
export type Model = typeof Model.Type

export const init = (target: Target): Model => ({
  target,
  sheet: Dialog.init({ id: `save-to-board-${target.kind}`, isAnimated: true }),
  name: '',
  saving: Saving.Idle(),
  resume: Option.none(),
})

// MESSAGE

export const Message = defineMessageUnion({
  ClickedSave: {},
  GotSheetMessage: { message: Dialog.Message },
  ClickedRetry: {},
  ClickedBoard: { boardId: Schema.String, boardName: Schema.String },
  UpdatedName: { value: Schema.String },
  SubmittedNewBoard: {},
  SucceededSave: { boardId: Schema.String, boardName: Schema.String },
  FailedSave: { resume: Resume },
})
export type Message = typeof Message.Type

/** The sheet opened, or its boards did not load: the app asks for them (again). */
export const OutMessage = defineMessageUnion({ RequestedBoards: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const pinsOf = (target: Target) =>
  target.kind === 'piece'
    ? Effect.map(Schema.decodeUnknownEffect(PieceId)(target.id), (pieceId) => ({ pieceIds: [pieceId] }))
    : Effect.map(Schema.decodeUnknownEffect(LookId)(target.id), (lookId) => ({ lookIds: [lookId] }))

/** The board a save goes to: the one tapped, the one an earlier try made, or a new one made under `operationId`. */
const boardFor = (destination: Destination, createdBoardId: Option.Option<string>, operationId: OperationId) =>
  Effect.gen(function* () {
    const known = Option.orElse(destination.boardId, () => createdBoardId)
    if (Option.isSome(known)) return yield* Schema.decodeUnknownEffect(BoardId)(known.value)
    const api = yield* (yield* StyldClient).api
    const name = yield* Schema.decodeUnknownEffect(BoardName)(destination.boardName)
    return (yield* api.board.createBoard({ payload: { operationId, name } })).id
  })

/** Put the target on the board under `operationId`. */
const pinned = (target: Target, boardId: BoardId, operationId: OperationId) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    if (target.kind === 'tryOn')
      yield* api.tryOn.addTryOnToBoard({
        params: { tryOnId: yield* Schema.decodeUnknownEffect(TryOnId)(target.id) },
        payload: { operationId, boardId },
      })
    else if (target.kind === 'photo' || target.kind === 'cutout')
      yield* api.photo.addToBoard({
        params: { photoId: yield* Schema.decodeUnknownEffect(PhotoId)(target.id) },
        payload: { operationId, boardId, picture: target.kind },
      })
    else
      yield* api.board.addPins({
        params: { boardId },
        payload: { operationId, placeOnTable: true, ...(yield* pinsOf(target)) },
      })
  })

/** Pin the target on a board, a new one first when it has only a name. A failure carries back what the next try to
 * the same place resumes: the operation ids drawn here (or given by the try before) and the board made. */
export const SaveTo = Command.define('SaveTo', {
  args: { target: Target, destination: Destination, resume: Schema.Option(Resume) },
  messages: [Message.SucceededSave, Message.FailedSave],
  execute: ({ target, destination, resume }) =>
    Effect.gen(function* () {
      const createOperationId = yield* drawOperationId(Option.map(resume, (earlier) => earlier.createOperationId))
      const pinOperationId = yield* drawOperationId(Option.map(resume, (earlier) => earlier.pinOperationId))
      const createdBefore = Option.flatMap(resume, (earlier) => earlier.createdBoardId)
      const failed = (createdBoardId: Option.Option<string>) =>
        Message.FailedSave({ resume: { destination, createOperationId, pinOperationId, createdBoardId } })
      const boardId = yield* Effect.option(boardFor(destination, createdBefore, createOperationId))
      if (Option.isNone(boardId)) return failed(createdBefore)
      const made = Option.isNone(destination.boardId) ? boardId : Option.none<string>()
      const done = yield* Effect.option(pinned(target, boardId.value, pinOperationId))
      return Option.isSome(done)
        ? Message.SucceededSave({ boardId: boardId.value, boardName: destination.boardName })
        : failed(made)
    }),
})

// UPDATE

type Services = StyldClient | SecureRandom.SecureRandom
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const sheet = sheetFolds<Model, Message>({
  read: (model) => model.sheet,
  write: (model, nextSheet) => modifyFields(model, { sheet: () => nextSheet }),
  toParentMessage: (message) => Message.GotSheetMessage({ message }),
})
const foldSheet = sheet.update
const openSheet = sheet.open

/** The sheet opens fresh, and asks for the boards again so a board made meanwhile is there. */
const opened = (model: Model): UpdateReturn =>
  Saving.guards.Sending(model.saving)
    ? { model }
    : Update.withOutMessage(
        openSheet(modifyFields(model, { name: () => '', saving: () => Saving.Idle() })),
        OutMessage.RequestedBoards(),
      )

/** Whether two saves go to the same place: the same board tapped, or a new board of the same name. */
const samePlace = (left: Destination, right: Destination) =>
  Option.match(left.boardId, {
    onNone: () => Option.isNone(right.boardId) && left.boardName === right.boardName,
    onSome: (boardId) => Option.contains(right.boardId, boardId),
  })

/** Send the save; a try to where the last one failed resumes it. */
const sent = (model: Model, destination: Destination): UpdateReturn =>
  Saving.guards.Sending(model.saving)
    ? { model }
    : {
        model: modifyFields(model, { saving: () => Saving.Sending() }),
        commands: [
          SaveTo({
            target: model.target,
            destination,
            resume: Option.filter(model.resume, (earlier) => samePlace(earlier.destination, destination)),
          }),
        ],
      }

/** "Save to board" inside a page whose model keeps it as `saveToBoard`; its request for the boards goes on up as the
 * page's own OutMessage. */
export const foldInto = <Parent extends { readonly saveToBoard: Model }, ParentMessage, ParentOutMessage>(
  toParentMessage: (message: Message) => ParentMessage,
  requestedBoards: () => ParentOutMessage,
) =>
  Update.foldChild({
    update: (model: Model, message: Message) => update(model, message),
    read: (parent: Parent) => Option.some(parent.saveToBoard),
    write: (parent: Parent, saveToBoard: Model): Parent => ({ ...parent, saveToBoard }),
    toParentMessage,
    toParentOutMessage: OutMessage.match({ RequestedBoards: requestedBoards }),
  })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedSave: () => opened(model),
    GotSheetMessage: (got) => foldSheet(model, got.message),
    ClickedRetry: () => ({ model, outMessage: OutMessage.RequestedBoards() }),
    ClickedBoard: ({ boardId, boardName }) => sent(model, { boardId: Option.some(boardId), boardName }),
    UpdatedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
    SubmittedNewBoard: () => {
      const name = model.name.trim()
      return name.length === 0 ? { model } : sent(model, { boardId: Option.none(), boardName: name })
    },
    SucceededSave: ({ boardId, boardName }) => ({
      model: modifyFields(model, {
        saving: () => Saving.Saved({ boardId, boardName }),
        name: () => '',
        resume: () => Option.none(),
      }),
    }),
    FailedSave: ({ resume }) => ({
      model: modifyFields(model, { saving: () => Saving.Failed(), resume: () => Option.some(resume) }),
    }),
  })
