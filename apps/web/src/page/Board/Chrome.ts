import { Dialog } from '@foldkit/ui'
import { Board, BoardId, BoardName, maximumMoods, Mood, PinId } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import type * as SecureRandom from 'effect/crypto/SecureRandom'
import { Command, Dom, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { load as loadPage } from 'foldkit/navigation'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Deletion } from '../../Confirm.ts'
import { drawOperationId } from '../../OperationIds.ts'
import { boardsRouter } from '../../route.ts'
import { StyldClient } from '../../StyldClient.ts'
import { sheetFolds } from '../Sheet.ts'

// The board page's chrome around its table: the title that renames it, the switch that makes it public, and the ⋯
// sheet with tidy and paste (the table's, so the board does them), its moods, its pins and deleting it. What the
// server answers about the board itself goes back to the board, which holds it.

// MODEL

/** Renaming the board in place, on its title: not asked, the name being typed, sent, or refused (the field stays). */
export const Rename = defineTaggedUnion({ Idle: {}, Editing: {}, Saving: {}, Failed: {} })
export type Rename = typeof Rename.Type

/** Making the board public or private with the switch beside Share; a board goes public only from a published profile. */
export const Publishing = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: { needsProfile: Schema.Boolean } })
export type Publishing = typeof Publishing.Type

/** Deleting the board: asked once more, then sent. */
export const Removal = Deletion
export type Removal = Deletion

/** A row of the ⋯ sheet that changes the table, which the board does once the sheet has closed. */
export const TableAction = Schema.Literals(['tidy', 'paste'])
export type TableAction = typeof TableAction.Type

export const Model = Schema.Struct({
  boardId: Schema.String,
  /** The board's ⋯ sheet: tidying, pasting, its moods, its pins and deleting it. */
  more: Dialog.Model,
  /** The name as it was when the title turned into a field, and what is typed there. */
  nameBefore: Schema.String,
  nameDraft: Schema.String,
  rename: Rename,
  removal: Removal,
  publishing: Publishing,
  /** The board's moods, as last saved or as just picked. */
  moods: Schema.Array(Mood),
  /** The pin whose × was pressed: it asks once more, since it comes off the table too (and a picture is deleted). */
  unpinning: Schema.Option(PinId),
})
export type Model = typeof Model.Type

export const init = (boardId: string): Model => ({
  boardId,
  more: Dialog.init({ id: 'board-more', isAnimated: true }),
  nameBefore: '',
  nameDraft: '',
  rename: Rename.Idle(),
  removal: Removal.Idle(),
  publishing: Publishing.Idle(),
  moods: [],
  unpinning: Option.none(),
})

/** The moods as the server has them. */
export const withMoods = (model: Model, moods: ReadonlyArray<Mood>): Model =>
  modifyFields(model, { moods: () => moods })

/** The pin asked about has gone to be taken off. */
export const unpinSent = (model: Model): Model => modifyFields(model, { unpinning: () => Option.none() })

// MESSAGE

export const Message = defineMessageUnion({
  ClickedMore: {},
  GotMoreMessage: { message: Dialog.Message },
  /** A row of the ⋯ sheet: the sheet closes, then the board tidies or pastes. */
  ClickedMoreAction: { action: TableAction },
  /** Rename, from the title or a row of the ⋯ sheet, with the name it has now. */
  ClickedRename: { name: Schema.String, fromSheet: Schema.Boolean },
  ClickedCancelRename: {},
  CompletedFocusName: {},
  UpdatedNameDraft: { value: Schema.String },
  SubmittedRename: {},
  SucceededRename: { board: Board },
  FailedRename: {},
  ToggledPublic: { isPublic: Schema.Boolean },
  SucceededSetVisibility: { board: Board },
  FailedSetVisibility: { needsProfile: Schema.Boolean },
  ToggledMood: { mood: Mood },
  SucceededSetBoardMoods: { board: Board },
  FailedSetBoardMoods: { attempted: Schema.Array(Mood), previous: Schema.Array(Mood) },
  ClickedDeleteBoard: {},
  ClickedKeepBoard: {},
  ClickedConfirmDelete: {},
  SucceededDeleteBoard: {},
  FailedDeleteBoard: {},
  CompletedLeaveBoard: {},
  ClickedUnpin: { pinId: PinId },
  ClickedConfirmUnpin: { pinId: PinId },
  ClickedKeepPin: { pinId: PinId },
  CompletedFocusPin: {},
})
export type Message = typeof Message.Type

/** What the board does or takes in: a table action from the ⋯ sheet, the board as the server answered a rename, the
 * public switch or the moods, and a pin to take off. */
export const OutMessage = defineMessageUnion({
  ChoseTableAction: { action: TableAction },
  Renamed: { board: Board },
  ChangedSharing: { board: Board },
  SavedMoods: { board: Board },
  ConfirmedUnpin: { pinId: PinId },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** The page's address holds the board's id as typed; one that is not an id reads as not found. */
const boardIdOf = (id: string) => Schema.decodeUnknownEffect(BoardId)(id)

/** The id of the field the title turns into for a rename. */
export const nameFieldId = 'board-name'

/** The ids the pin's × and its Keep carry, so focus can move between them. */
export const unpinId = (pinId: string) => `unpin-${pinId}`
export const keepPinId = (pinId: string) => `keep-${pinId}`

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

/** The board's name field takes focus as the title turns into it. */
export const FocusName = Command.define('FocusName', {
  messages: [Message.CompletedFocusName],
  execute: Dom.focus(`#${nameFieldId}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocusName())),
})

// UPDATE

type Services = StyldClient | SecureRandom.SecureRandom
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const moreSheet = sheetFolds<Model, Message>({
  read: (model) => model.more,
  write: (model, more) => modifyFields(model, { more: () => more }),
  toParentMessage: (message) => Message.GotMoreMessage({ message }),
})

/** The ⋯ sheet opens with nothing pending. */
const moreOpened = (model: Model): UpdateReturn =>
  moreSheet.open(modifyFields(model, { removal: () => Removal.Idle() }))

/** The title becomes a field holding the board's name, focused. */
const renameStarted = (model: Model, name: string): Update.Return<Model, Message, Services> => ({
  model: modifyFields(model, { nameBefore: () => name, nameDraft: () => name, rename: () => Rename.Editing() }),
  commands: [FocusName()],
})

const renameSubmitted = (model: Model): UpdateReturn => {
  const name = model.nameDraft.trim()
  if (name.length === 0 || name === model.nameBefore)
    return { model: modifyFields(model, { rename: () => Rename.Idle() }) }
  return {
    model: modifyFields(model, { rename: () => Rename.Saving() }),
    commands: [RenameBoard({ boardId: model.boardId, name })],
  }
}

/** A mood on or off, saved at once; a fourth waits until one is taken off. */
const moodToggled = (model: Model, mood: Mood): UpdateReturn => {
  const moods = model.moods.includes(mood)
    ? model.moods.filter((each) => each !== mood)
    : model.moods.length < maximumMoods
      ? [...model.moods, mood]
      : model.moods
  return moods === model.moods
    ? { model }
    : {
        model: modifyFields(model, { moods: () => moods }),
        commands: [SetBoardMoods({ boardId: model.boardId, moods, previous: model.moods })],
      }
}

const sameMoods = (left: ReadonlyArray<Mood>, right: ReadonlyArray<Mood>) =>
  left.length === right.length && left.every((mood) => right.includes(mood))

/** Moods that did not save give way to the ones before them, unless the person has changed them again since. */
const moodsFailed = (model: Model, attempted: ReadonlyArray<Mood>, previous: ReadonlyArray<Mood>): UpdateReturn =>
  sameMoods(model.moods, attempted) ? { model: modifyFields(model, { moods: () => previous }) } : { model }

/** Moods saved: who sees the board and its check go to the board as the server has them, unless other moods are on
 * their way. */
const moodsSaved = (model: Model, board: Board): UpdateReturn =>
  sameMoods(model.moods, board.moods) ? { model, outMessage: OutMessage.SavedMoods({ board }) } : { model }

/** Public or private, from the switch beside Share; the check's word on it shows under the title. */
const publicToggled = (model: Model, isPublic: boolean): UpdateReturn =>
  Publishing.guards.Sending(model.publishing)
    ? { model }
    : {
        model: modifyFields(model, { publishing: () => Publishing.Sending() }),
        commands: [SetBoardVisibility({ boardId: model.boardId, isPublic })],
      }

/** The × asks first: the pin leaves the board and its table, and a picture is deleted, with no way to put it back. */
const unpinAsked = (model: Model, pinId: PinId): UpdateReturn => ({
  model: modifyFields(model, { unpinning: () => Option.some(pinId) }),
  commands: [FocusPin({ selector: `#${keepPinId(pinId)}` })],
})

const pinKept = (model: Model, pinId: PinId): UpdateReturn => ({
  model: modifyFields(model, { unpinning: () => Option.none() }),
  commands: [FocusPin({ selector: `#${unpinId(pinId)}` })],
})

/** A row of the ⋯ sheet: the sheet closes, then the board is renamed here or the table tidied or pasted to there. */
const sheetRow = (model: Model, step: (closed: Model) => UpdateReturn): UpdateReturn => {
  const closed = moreSheet.close(model)
  const next = step(closed.model)
  return { ...next, commands: [...(closed.commands ?? []), ...(next.commands ?? [])] }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedMore: () => moreOpened(model),
    GotMoreMessage: ({ message: sheetMessage }) => moreSheet.update(model, sheetMessage),
    ClickedMoreAction: ({ action }) =>
      sheetRow(model, (closed) => ({ model: closed, outMessage: OutMessage.ChoseTableAction({ action }) })),
    ClickedRename: ({ name, fromSheet }) =>
      fromSheet ? sheetRow(model, (closed) => renameStarted(closed, name)) : renameStarted(model, name),
    ClickedCancelRename: () => ({ model: modifyFields(model, { rename: () => Rename.Idle() }) }),
    CompletedFocusName: () => ({ model }),
    UpdatedNameDraft: ({ value }) => ({ model: modifyFields(model, { nameDraft: () => value }) }),
    SubmittedRename: () => renameSubmitted(model),
    SucceededRename: ({ board }) => ({
      model: modifyFields(model, { rename: () => Rename.Idle() }),
      outMessage: OutMessage.Renamed({ board }),
    }),
    FailedRename: () => ({ model: modifyFields(model, { rename: () => Rename.Failed() }) }),
    ToggledPublic: ({ isPublic }) => publicToggled(model, isPublic),
    SucceededSetVisibility: ({ board }) => ({
      model: modifyFields(model, { publishing: () => Publishing.Idle(), moods: () => board.moods }),
      outMessage: OutMessage.ChangedSharing({ board }),
    }),
    FailedSetVisibility: ({ needsProfile }) => ({
      model: modifyFields(model, { publishing: () => Publishing.Failed({ needsProfile }) }),
    }),
    ToggledMood: ({ mood }) => moodToggled(model, mood),
    SucceededSetBoardMoods: ({ board }) => moodsSaved(model, board),
    FailedSetBoardMoods: ({ attempted, previous }) => moodsFailed(model, attempted, previous),
    ClickedDeleteBoard: () => ({ model: modifyFields(model, { removal: () => Removal.Confirming() }) }),
    ClickedKeepBoard: () => ({ model: modifyFields(model, { removal: () => Removal.Idle() }) }),
    ClickedConfirmDelete: () => ({
      model: modifyFields(model, { removal: () => Removal.Deleting() }),
      commands: [DeleteBoard({ boardId: model.boardId })],
    }),
    SucceededDeleteBoard: () => ({ model, commands: [LeaveBoard()] }),
    FailedDeleteBoard: () => ({ model: modifyFields(model, { removal: () => Removal.Failed() }) }),
    CompletedLeaveBoard: () => ({ model }),
    ClickedUnpin: ({ pinId }) => unpinAsked(model, pinId),
    ClickedConfirmUnpin: ({ pinId }) => ({ model, outMessage: OutMessage.ConfirmedUnpin({ pinId }) }),
    ClickedKeepPin: ({ pinId }) => pinKept(model, pinId),
    CompletedFocusPin: () => ({ model }),
  })
