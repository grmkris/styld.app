import { type Board, LookPin } from '@styld/protocol'
import { Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import * as Chrome from './Chrome.ts'
import { MakeIds } from './Editor/Commands.ts'
import type { Services } from './Editor/Edits.ts'
import * as Editor from './Editor/Model.ts'
import * as EditorMessage from './Editor/Message.ts'
import * as EditorUpdate from './Editor/Update.ts'
import { Message } from './Message.ts'
import { BoardData, BoardShown, fromBoard, type Model, PinWork, withChecked, withSharing } from './Model.ts'
import type { LoadError } from '../../ServerData.ts'
import {
  becameVisible,
  paperFailed,
  paperSaved,
  paperSelected,
  pinsChanged,
  reloaded,
  restartedFrom,
  unpinConfirmed,
  type UpdateReturn,
} from './Page.ts'
import * as People from '../People.ts'
import * as TryIt from './TryIt.ts'
import * as Share from '../Share.ts'
import * as Make from './Make.ts'
import * as Outfits from './Outfits.ts'
import { LoadBoard, PinLook, ReloadBoard, VisitBoard } from './PageCommands.ts'

type Step = Update.Step<Model, Message, Services>

/** What the board's page is told by the app: whether there is a session, as the app knows it now (the cookie's hint
 * until the session is read). */
export type Context = { readonly signedIn: boolean }

const toEditor = (message: EditorMessage.Message) => Message.GotEditorMessage({ message })

/** The Commands that open the board: the board and a first batch of ids (the app reads the pieces for the tray).
 * Signed out it can only be someone's public board, read as visitors read it, with nothing to edit. */
export const load = (model: Model, { signedIn }: Context): ReadonlyArray<Command.Command<Message, never, Services>> =>
  signedIn
    ? [LoadBoard({ boardId: model.boardId }), Command.mapMessage(MakeIds(), toEditor)]
    : [VisitBoard({ boardId: model.boardId })]

/** A look put on the table is pinned too, unless it is already. */
const lookPlaced = (model: Model, lookId: string): UpdateReturn =>
  model.pins.some((pin) => Schema.is(LookPin)(pin) && pin.look.id === lookId)
    ? { model }
    : { model, commands: [PinLook({ boardId: model.boardId, lookId })] }

const editorSlot = {
  read: (model: Model) => Option.some(model.editor),
  write: (model: Model, editor: Editor.Model) => modifyFields(model, { editor: () => editor }),
  toParentMessage: toEditor,
}

/** The editor's word: a saved table or look brings the board's pins, a table saved elsewhere the whole board, a paper
 * chosen is the board's to save, and a look put on the table is pinned. */
const foldEditor = Update.foldChild({
  update: EditorUpdate.update,
  ...editorSlot,
  foldOutMessage: EditorMessage.OutMessage.match<Step>({
    SavedTable:
      ({ board }) =>
      (model) => ({
        model: modifyFields(model, { pins: () => board.pins, publicPins: () => board.publicPins }),
      }),
    ReplacedTable:
      ({ board }) =>
      (model) => ({
        model: modifyFields(withSharing(model, board), {
          pins: () => board.pins,
          outfits: (outfits) => Outfits.withBoard(outfits, board),
        }),
      }),
    SavedLook:
      ({ board }) =>
      (model) => ({ model: modifyFields(model, { pins: () => board.pins }) }),
    ChosePaper:
      ({ paper }) =>
      (model) =>
        paperSelected(model, paper),
    PlacedLook:
      ({ lookId }) =>
      (model) =>
        lookPlaced(model, lookId),
  }),
})
const tidy = Update.foldChildStep({ update: EditorUpdate.tidy, ...editorSlot })
const paste = Update.foldChildStep({ update: EditorUpdate.paste, ...editorSlot })

const foldPeople = Update.foldChild({
  update: People.update,
  ...People.heldBy<Model, Message>((message) => Message.GotPeopleMessage({ message })),
})
const foldTryIt = Update.foldChild({
  update: TryIt.update,
  read: (model: Model) => Option.some(model.tryIt),
  write: (model: Model, tryIt: TryIt.Model) => modifyFields(model, { tryIt: () => tryIt }),
  toParentMessage: (message: TryIt.Message) => Message.GotTryItMessage({ message }),
})
const foldShare = Update.foldChild({
  update: Share.update,
  ...Share.heldBy<Model, Message>((message) => Message.GotShareMessage({ message })),
})

/** Make with Styld: once an ask ends, the board reloads to show what it added. */
const foldMake = Update.foldChild({
  update: Make.update,
  read: (model: Model) => Option.some(model.make),
  write: (model: Model, make: Make.Model) => modifyFields(model, { make: () => make }),
  toParentMessage: (message: Make.Message) => Message.GotMakeMessage({ message }),
  foldOutMessage: Make.OutMessage.match<Step>({
    FinishedMaking: () => (model) => ({ model, commands: [ReloadBoard({ boardId: model.boardId })] }),
  }),
})

/** A card kept an outfit or put another in its place: a keep pins a look and leaves the table; another outfit brings a
 * new table, which the editor takes with a fresh history, as one saved elsewhere. */
const outfitChanged = (model: Model, board: Board): UpdateReturn =>
  board.version === model.editor.version
    ? { model: modifyFields(model, { pins: () => board.pins, publicPins: () => board.publicPins }) }
    : {
        model: modifyFields(restartedFrom(model, board), {
          editor: (editor) =>
            modifyFields(editor, { saving: () => Editor.Saving.Saved(), gesture: () => Editor.Gesture.Idle() }),
        }),
      }

const foldOutfits = Update.foldChild({
  update: Outfits.update,
  read: (model: Model) => Option.some(model.outfits),
  write: (model: Model, outfits: Outfits.Model) => modifyFields(model, { outfits: () => outfits }),
  toParentMessage: (message: Outfits.Message) => Message.GotOutfitsMessage({ message }),
  foldOutMessage: Outfits.OutMessage.match<Step>({
    ChangedBoard:
      ({ board }) =>
      (model) =>
        outfitChanged(model, board),
  }),
})

/** The look's pin, once the board holds it; one that did not go through leaves the table as it is. */
const lookPinned = (model: Model, maybeBoard: Option.Option<Board>): UpdateReturn =>
  Option.match(maybeBoard, {
    onNone: () => ({ model }),
    onSome: (board) => ({ model: modifyFields(model, { pins: () => board.pins, publicPins: () => board.publicPins }) }),
  })

/** The chrome's word: the ⋯ sheet's tidy or paste, the board as a rename, the public switch or the moods left it, and
 * a pin to take off. */
const foldChrome = Update.foldChild({
  update: Chrome.update,
  read: (model: Model) => Option.some(model.chrome),
  write: (model: Model, chrome: Chrome.Model) => modifyFields(model, { chrome: () => chrome }),
  toParentMessage: (message: Chrome.Message) => Message.GotChromeMessage({ message }),
  foldOutMessage: Chrome.OutMessage.match<Step>({
    ChoseTableAction: ({ action }) => (action === 'tidy' ? tidy : paste),
    Renamed:
      ({ board }) =>
      (model) => ({
        model: modifyFields(model, {
          board: () => BoardData.Success({ data: BoardShown.Own({ name: board.name, paper: board.paper }) }),
        }),
      }),
    ChangedSharing:
      ({ board }) =>
      (model) => ({ model: withSharing(model, board) }),
    SavedMoods:
      ({ board }) =>
      (model) => ({ model: withChecked(model, board) }),
    ConfirmedUnpin:
      ({ pinId }) =>
      (model) =>
        unpinConfirmed(model, pinId),
  }),
})

const loadFailed = (model: Model, error: LoadError): UpdateReturn => ({
  model: modifyFields(model, { board: (board) => AsyncData.settle(board, Result.fail(error)) }),
})

export const update = (model: Model, message: Message, context: Context): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadBoard: ({ board }) => ({
      model: fromBoard(model, board),
      commands: Command.mapMessages(Make.resume(model.make), (made) => Message.GotMakeMessage({ message: made })),
    }),
    FailedLoadBoard: ({ error }) => loadFailed(model, error),
    SucceededVisitBoard: ({ board }) => ({
      model: modifyFields(model, { board: () => BoardData.Success({ data: BoardShown.Visiting({ board }) }) }),
    }),
    ClickedRetry: () => ({
      model: modifyFields(model, { board: () => AsyncData.Loading() }),
      commands: load(model, context),
    }),
    SucceededUpdatePaper: ({ board }) => paperSaved(model, board),
    FailedUpdatePaper: ({ attempted, previous }) => paperFailed(model, attempted, previous),
    BecameVisible: () => becameVisible(model),
    CompletedReloadBoard: ({ maybeBoard }) =>
      Option.match(maybeBoard, { onNone: () => ({ model }), onSome: (board) => reloaded(model, board) }),
    GotEditorMessage: (got) => foldEditor(model, got.message),
    GotChromeMessage: (got) => foldChrome(model, got.message),
    GotPeopleMessage: (got) => foldPeople(model, got.message),
    GotTryItMessage: (got) => foldTryIt(model, got.message),
    GotShareMessage: (got) => foldShare(model, got.message),
    GotMakeMessage: (got) => foldMake(model, got.message),
    GotOutfitsMessage: (got) => foldOutfits(model, got.message),
    CompletedPinLook: ({ maybeBoard }) => lookPinned(model, maybeBoard),
    SucceededPins: ({ board }) => pinsChanged(model, board),
    FailedPins: () => ({ model: modifyFields(model, { pinWork: () => PinWork.Failed() }) }),
  })
