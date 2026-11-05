import { FileDrop } from '@foldkit/ui'
import { type Board, type Look, LookPin, PieceItem, tidied } from '@styld/protocol'
import { Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import {
  addedImage,
  addedPiece,
  addedPieces,
  picturesSent,
  placedPicture,
  addedText,
  duplicated,
  exited,
  flipped,
  layered,
  lookRequested,
  tickToggled,
  imageFailed,
  paperFailed,
  paperSaved,
  paperSelected,
  picturesChosen,
  removed,
  styleSelected,
  textUpdated,
  toastElapsed,
  undoRemove,
} from './Actions.ts'
import {
  AddGalleryPicture,
  AddTryOnPicture,
  LoadBoard,
  MakeIds,
  ReadClipboard,
  unitsPerPixel,
  VisitBoard,
} from './Commands.ts'
import { committed, redone, replaced, saved, saveNow, type Services, type UpdateReturn, undone } from './Edits.ts'
import {
  keyed,
  movedPointer,
  pressedEscape,
  pressedHandle,
  pressedItem,
  pressedPaper,
  releasedPointer,
} from './Gestures.ts'
import { Message } from './Message.ts'
import {
  BoardData,
  BoardShown,
  fromBoard,
  Gesture,
  LookSave,
  type Model,
  PinWork,
  Saving,
  Ticks,
  withChecked,
  withSharing,
} from './Model.ts'
import type { LoadError } from '../../ServerData.ts'
import * as AddSheet from './AddSheet.ts'
import * as Chrome from './Chrome.ts'
import { becameVisible, pinsChanged, reloaded, unpinConfirmed } from './Page.ts'
import * as People from '../People.ts'
import * as TryIt from './TryIt.ts'
import * as Share from '../Share.ts'
import * as Make from './Make.ts'
import * as Outfits from './Outfits.ts'
import { PinLook, ReloadBoard } from './PageCommands.ts'

/** What the board's page is told by the app: whether there is a session, as the app knows it now (the cookie's hint
 * until the session is read). */
export type Context = { readonly signedIn: boolean }

/** The Commands that open the board: the board and a first batch of ids (the app reads the pieces for the tray).
 * Signed out it can only be someone's public board, read as visitors read it, with nothing to edit. */
export const load = (model: Model, { signedIn }: Context): ReadonlyArray<Command.Command<Message, never, Services>> =>
  signedIn ? [LoadBoard({ boardId: model.boardId }), MakeIds()] : [VisitBoard({ boardId: model.boardId })]

const foldPeople = People.foldInto<Model, Message>((message) => Message.GotPeopleMessage({ message }))
const foldTryIt = Update.foldChild({
  update: TryIt.update,
  read: (model: Model) => Option.some(model.tryIt),
  write: (model: Model, tryIt: TryIt.Model) => modifyFields(model, { tryIt: () => tryIt }),
  toParentMessage: (message: TryIt.Message) => Message.GotTryItMessage({ message }),
})
const foldShare = Share.foldInto<Model, Message>((message) => Message.GotShareMessage({ message }))

/** Make with Styld: once an ask ends, the board reloads to show what it added. */
const foldMake = Update.foldChild({
  update: Make.update,
  read: (model: Model) => Option.some(model.make),
  write: (model: Model, make: Make.Model) => modifyFields(model, { make: () => make }),
  toParentMessage: (message: Make.Message) => Message.GotMakeMessage({ message }),
  foldOutMessage: Make.OutMessage.match<Update.Step<Model, Message, Services>>({
    FinishedMaking: () => (model) => ({ model, commands: [ReloadBoard({ boardId: model.boardId })] }),
  }),
})

/** A card kept an outfit or put another in its place: a keep pins a look and leaves the table; another outfit brings a
 * new table, which the editor takes with a fresh history, as one saved elsewhere. */
const outfitChanged = (model: Model, board: Board): UpdateReturn =>
  board.version === model.version
    ? { model: modifyFields(model, { pins: () => board.pins, publicPins: () => board.publicPins }) }
    : {
        model: modifyFields(fromBoard(model, board), {
          saving: () => Saving.Saved(),
          past: () => [],
          future: () => [],
          gesture: () => Gesture.Idle(),
          maybeSelectedId: () => Option.none(),
        }),
      }

const foldOutfits = Update.foldChild({
  update: Outfits.update,
  read: (model: Model) => Option.some(model.outfits),
  write: (model: Model, outfits: Outfits.Model) => modifyFields(model, { outfits: () => outfits }),
  toParentMessage: (message: Outfits.Message) => Message.GotOutfitsMessage({ message }),
  foldOutMessage: Outfits.OutMessage.match<Update.Step<Model, Message, Services>>({
    ChangedBoard:
      ({ board }) =>
      (model) =>
        outfitChanged(model, board),
  }),
})

const foldDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.drop),
  write: (model: Model, drop: FileDrop.Model) => modifyFields(model, { drop: () => drop }),
  toParentMessage: (message: FileDrop.Message) => Message.GotDropMessage({ message }),
  foldOutMessage: FileDrop.OutMessage.match<Update.Step<Model, Message, Services>>({
    ReceivedFiles:
      ({ files }) =>
      (model) =>
        picturesChosen(model, files),
    RejectedNonFiles: () => (model) => ({ model }),
  }),
})

/** A look's pieces go on the table as one step, and the look is pinned unless it is already. */
const lookChosen = (model: Model, look: Look): UpdateReturn => {
  const isPinned = model.pins.some((pin) => Schema.is(LookPin)(pin) && pin.look.id === look.id)
  const placed = addedPieces(
    model,
    look.pieces.map((piece) => piece.id),
  )
  return isPinned
    ? placed
    : {
        model: placed.model,
        commands: [...(placed.commands ?? []), PinLook({ boardId: model.boardId, lookId: look.id })],
      }
}

/** The look's pin, once the board holds it; one that did not go through leaves the table as it is. */
const lookPinned = (model: Model, maybeBoard: Option.Option<Board>): UpdateReturn =>
  Option.match(maybeBoard, {
    onNone: () => ({ model }),
    onSome: (board) => ({ model: modifyFields(model, { pins: () => board.pins, publicPins: () => board.publicPins }) }),
  })

/** The Add sheet's choice goes on the table: a piece, a look's pieces, a picture pinned here, or a Gallery photo or a
 * try-on sent up as a picture that lands when the board holds it. */
const foldAddSheet = Update.foldChild({
  update: AddSheet.update,
  read: (model: Model) => Option.some(model.addSheet),
  write: (model: Model, addSheet: AddSheet.Model) => modifyFields(model, { addSheet: () => addSheet }),
  toParentMessage: (message: AddSheet.Message) => Message.GotAddSheetMessage({ message }),
  foldOutMessage: AddSheet.OutMessage.match<Update.Step<Model, Message, Services>>({
    ChosePiece:
      ({ pieceId }) =>
      (model) =>
        addedPiece(model, pieceId),
    ChosePinnedPicture:
      ({ imageId }) =>
      (model) =>
        placedPicture(model, imageId),
    ChoseLook:
      ({ look }) =>
      (model) =>
        lookChosen(model, look),
    ChosePhoto:
      ({ photoId, picture }) =>
      (model) =>
        picturesSent(model, [AddGalleryPicture({ boardId: model.boardId, photoId, picture })]),
    ChoseTryOn:
      ({ tryOnId }) =>
      (model) =>
        picturesSent(model, [AddTryOnPicture({ boardId: model.boardId, tryOnId })]),
  }),
})

const tidy = (model: Model): UpdateReturn => committed(model, model.items, tidied(model.items))

/** Paste asks the browser for the clipboard's pictures; a phone's browser shares them only on a tap. */
const pasted = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { isPasting: () => true }),
  commands: [ReadClipboard()],
})

/** Save as a look's first tap: every piece on the table ticked, for the person to leave some out. */
const selectionStarted = (model: Model): UpdateReturn => ({
  model: modifyFields(model, {
    ticks: () => Ticks.On({ itemIds: model.items.filter(Schema.is(PieceItem)).map((item) => item.id) }),
    maybeSelectedId: () => Option.none(),
  }),
})

/** The chrome's word: the ⋯ sheet's tidy or paste, the board as a rename, the public switch or the moods left it, and
 * a pin to take off. */
const foldChrome = Update.foldChild({
  update: Chrome.update,
  read: (model: Model) => Option.some(model.chrome),
  write: (model: Model, chrome: Chrome.Model) => modifyFields(model, { chrome: () => chrome }),
  toParentMessage: (message: Chrome.Message) => Message.GotChromeMessage({ message }),
  foldOutMessage: Chrome.OutMessage.match<Update.Step<Model, Message, Services>>({
    ChoseTableAction:
      ({ action }) =>
      (model) =>
        action === 'tidy' ? tidy(model) : pasted(model),
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
    GotPeopleMessage: (got) => foldPeople(model, got.message),
    GotTryItMessage: (got) => foldTryIt(model, got.message),
    GotShareMessage: (got) => foldShare(model, got.message),
    GotMakeMessage: (got) => foldMake(model, got.message),
    GotOutfitsMessage: (got) => foldOutfits(model, got.message),
    CompletedMakeIds: ({ ids }) => ({ model: modifyFields(model, { ids: (pool) => [...pool, ...ids] }) }),
    MeasuredPaper: ({ width }) => ({ model: modifyFields(model, { pxPerUnit: () => unitsPerPixel(width) }) }),
    PressedItem: ({ id, pointer, isTouch }) => pressedItem(model, id, pointer, isTouch),
    PressedHandle: ({ id, pointer, centerX, centerY }) => pressedHandle(model, id, pointer, centerX, centerY),
    PressedPaper: ({ pointer }) => pressedPaper(model, pointer),
    MovedPointer: ({ pointer }) => movedPointer(model, pointer),
    ReleasedPointer: ({ pointerId }) => releasedPointer(model, pointerId),
    FocusedItem: ({ id }) =>
      Ticks.guards.On(model.ticks)
        ? { model }
        : { model: modifyFields(model, { maybeSelectedId: () => Option.some(id) }) },
    PressedItemKey: ({ id, step, isShifted }) =>
      step === 'remove' ? removed(model, id) : keyed(model, id, step, isShifted),
    PressedUndoKey: () => undone(model),
    PressedRedoKey: () => redone(model),
    PressedEscape: () => pressedEscape(model),
    ClickedUndo: () => undone(model),
    ClickedRedo: () => redone(model),
    ClickedAddText: ({ text }) => addedText(model, text),
    ClickedFlip: ({ id }) => flipped(model, id),
    ClickedDuplicate: ({ id }) => duplicated(model, id),
    ClickedLayer: ({ id }) => layered(model, id),
    ClickedRemove: ({ id }) => removed(model, id),
    ClickedUndoRemove: () => undoRemove(model),
    ElapsedToast: ({ generation }) => toastElapsed(model, generation),
    CompletedExit: ({ id }) => exited(model, id),
    UpdatedText: ({ id, text }) => textUpdated(model, id, text),
    SelectedTextStyle: ({ id, style }) => styleSelected(model, id, style),
    SelectedPaper: ({ paper }) => paperSelected(model, paper),
    SucceededUpdatePaper: ({ board }) => paperSaved(model, board),
    FailedUpdatePaper: ({ attempted, previous }) => paperFailed(model, attempted, previous),
    ElapsedSaveWait: ({ generation }) => saveNow(model, generation),
    SucceededSaveItems: ({ board }) => saved(model, board),
    FailedSaveItems: () => ({ model: modifyFields(model, { saving: () => Saving.Failed() }) }),
    ReplacedByNewerBoard: ({ board }) => replaced(model, board),
    GotDropMessage: (got) => foldDrop(model, got.message),
    PastedFiles: ({ files }) => picturesChosen(model, files),
    DroppedFiles: ({ files }) => picturesChosen(modifyFields(model, { isDropping: () => false }), files),
    DraggedFilesOver: () => (model.isDropping ? { model } : { model: modifyFields(model, { isDropping: () => true }) }),
    EndedFileDrag: () => ({ model: modifyFields(model, { isDropping: () => false }) }),
    CompletedReadClipboard: ({ files }) => picturesChosen(model, files),
    SucceededAddImage: ({ imageId, image }) => addedImage(model, imageId, image),
    FailedAddImage: ({ problem }) => imageFailed(model, problem),
    GotChromeMessage: (got) => foldChrome(model, got.message),
    BecameVisible: () => becameVisible(model),
    CompletedReloadBoard: ({ maybeBoard }) =>
      Option.match(maybeBoard, { onNone: () => ({ model }), onSome: (board) => reloaded(model, board) }),
    SucceededPins: ({ board }) => pinsChanged(model, board),
    FailedPins: () => ({ model: modifyFields(model, { pinWork: () => PinWork.Failed() }) }),
    GotAddSheetMessage: (got) => foldAddSheet(model, got.message),
    CompletedPinLook: ({ maybeBoard }) => lookPinned(model, maybeBoard),
    ClickedCancelSelecting: () => ({ model: modifyFields(model, { ticks: () => Ticks.Off() }) }),
    ToggledTick: ({ id }) => tickToggled(model, id),
    ClickedSaveLook: () => (Ticks.guards.On(model.ticks) ? lookRequested(model) : selectionStarted(model)),
    SucceededSaveLook: ({ lookId, board }) => ({
      model: modifyFields(model, { look: () => LookSave.Saved({ lookId }), pins: () => board.pins }),
    }),
    FailedSaveLook: () => ({ model: modifyFields(model, { look: () => LookSave.Failed() }) }),
    ClickedRetry: () => ({
      model: modifyFields(model, { board: () => AsyncData.Loading() }),
      commands: load(model, context),
    }),
  })
