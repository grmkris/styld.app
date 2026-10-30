import { FileDrop } from '@foldkit/ui'
import { Option } from 'effect'
import { Command, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import {
  addedImage,
  addedPiece,
  addedText,
  duplicated,
  exited,
  flipped,
  layered,
  lookRequested,
  paperSelected,
  picturesChosen,
  removed,
  styleSelected,
  textUpdated,
  toastElapsed,
  undoRemove,
} from './Actions.ts'
import * as WardrobePage from '../Wardrobe.ts'
import { LoadBoard, MakeIds, ReadClipboard, unitsPerPixel } from './Commands.ts'
import { committed, redone, replaced, saved, saveNow, type Services, type UpdateReturn, undone } from './Edits.ts'
import { tidied } from './Geometry.ts'
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
import { BoardState, fromBoard, LookSave, type Model, Saving, Upload } from './Model.ts'

/** The Commands that open the board: the board, the wardrobe for the tray, and a first batch of ids. */
export const load = (model: Model): ReadonlyArray<Command.Command<Message, never, Services>> => [
  LoadBoard({ boardId: model.boardId }),
  ...Command.mapMessages(WardrobePage.load(), (message) => Message.GotWardrobeMessage({ message })),
  MakeIds(),
]

const foldWardrobe = Update.foldChild({
  update: WardrobePage.update,
  read: (model: Model) => Option.some(model.wardrobe),
  write: (model: Model, wardrobe: WardrobePage.Model) => modifyFields(model, { wardrobe: () => wardrobe }),
  toParentMessage: (message: WardrobePage.Message) => Message.GotWardrobeMessage({ message }),
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

const loadFailed = (model: Model, missing: boolean): UpdateReturn => ({
  model: modifyFields(model, { board: () => (missing ? BoardState.Missing() : BoardState.Failed()) }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadBoard: ({ board }) => ({ model: fromBoard(model, board) }),
    FailedLoadBoard: ({ missing }) => loadFailed(model, missing),
    GotWardrobeMessage: (got) => foldWardrobe(model, got.message),
    CompletedMakeIds: ({ ids }) => ({ model: modifyFields(model, { ids: (pool) => [...pool, ...ids] }) }),
    MeasuredPaper: ({ width }) => ({ model: modifyFields(model, { pxPerUnit: () => unitsPerPixel(width) }) }),
    PressedItem: ({ id, pointer, isTouch }) => pressedItem(model, id, pointer, isTouch),
    PressedHandle: ({ id, pointer, centerX, centerY }) => pressedHandle(model, id, pointer, centerX, centerY),
    PressedPaper: ({ pointer }) => pressedPaper(model, pointer),
    MovedPointer: ({ pointer }) => movedPointer(model, pointer),
    ReleasedPointer: ({ pointerId }) => releasedPointer(model, pointerId),
    FocusedItem: ({ id }) => ({ model: modifyFields(model, { maybeSelectedId: () => Option.some(id) }) }),
    PressedItemKey: ({ id, step, isShifted }) =>
      step === 'remove' ? removed(model, id) : keyed(model, id, step, isShifted),
    PressedUndoKey: () => undone(model),
    PressedRedoKey: () => redone(model),
    PressedEscape: () => pressedEscape(model),
    ClickedUndo: () => undone(model),
    ClickedRedo: () => redone(model),
    ClickedTidy: () => committed(model, model.items, tidied(model.items)),
    ClickedAddText: ({ text }) => addedText(model, text),
    ClickedWardrobePiece: ({ pieceId }) => addedPiece(model, pieceId),
    ClickedFlip: ({ id }) => flipped(model, id),
    ClickedDuplicate: ({ id }) => duplicated(model, id),
    ClickedForward: ({ id }) => layered(model, id, 'forward'),
    ClickedBackward: ({ id }) => layered(model, id, 'backward'),
    ClickedRemove: ({ id }) => removed(model, id),
    ClickedUndoRemove: () => undoRemove(model),
    ElapsedToast: ({ generation }) => toastElapsed(model, generation),
    CompletedExit: ({ id }) => exited(model, id),
    UpdatedText: ({ id, text }) => textUpdated(model, id, text),
    SelectedTextStyle: ({ id, style }) => styleSelected(model, id, style),
    SelectedPaper: ({ paper }) => paperSelected(model, paper),
    SucceededUpdateBoard: () => ({ model }),
    FailedUpdateBoard: () => ({ model }),
    ElapsedSaveWait: ({ generation }) => saveNow(model, generation),
    SucceededSaveItems: ({ board }) => saved(model, board),
    FailedSaveItems: () => ({ model: modifyFields(model, { saving: () => Saving.Failed() }) }),
    ReplacedByNewerBoard: ({ board }) => replaced(model, board),
    GotDropMessage: (got) => foldDrop(model, got.message),
    PastedFiles: ({ files }) => picturesChosen(model, files),
    DroppedFiles: ({ files }) => picturesChosen(modifyFields(model, { isDropping: () => false }), files),
    DraggedFilesOver: () => (model.isDropping ? { model } : { model: modifyFields(model, { isDropping: () => true }) }),
    EndedFileDrag: () => ({ model: modifyFields(model, { isDropping: () => false }) }),
    ClickedPaste: () => ({ model: modifyFields(model, { isPasting: () => true }), commands: [ReadClipboard()] }),
    CompletedReadClipboard: ({ files }) => picturesChosen(model, files),
    SucceededAddImage: ({ imageId }) => addedImage(model, imageId),
    FailedAddImage: ({ refused }) => ({ model: modifyFields(model, { upload: () => Upload.Failed({ refused }) }) }),
    ClickedSaveLook: () => lookRequested(model),
    SucceededSaveLook: ({ lookId }) => ({ model: modifyFields(model, { look: () => LookSave.Saved({ lookId }) }) }),
    FailedSaveLook: () => ({ model: modifyFields(model, { look: () => LookSave.Failed() }) }),
    ClickedRetry: () => ({ model: modifyFields(model, { board: () => BoardState.Loading() }), commands: load(model) }),
  })
