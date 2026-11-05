import { FileDrop } from '@foldkit/ui'
import { PieceItem, tidied } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import {
  addedImage,
  addedPiece,
  addedPieces,
  addedText,
  duplicated,
  exited,
  flipped,
  imageFailed,
  layered,
  lookRequested,
  picturesChosen,
  picturesSent,
  placedPicture,
  removed,
  styleSelected,
  textUpdated,
  tickToggled,
  toastElapsed,
  undoRemove,
} from './Actions.ts'
import * as AddSheet from '../AddSheet.ts'
import { AddGalleryPicture, AddTryOnPicture, ReadClipboard, unitsPerPixel } from './Commands.ts'
import { committed, redone, replaced, saved, saveNow, type Services, type UpdateReturn, undone } from './Edits.ts'
import { LookSave, type Model, Saving, Ticks, Upload, uploadProblem } from './Model.ts'
import { Message, OutMessage } from './Message.ts'
import {
  keyed,
  movedPointer,
  pressedEscape,
  pressedHandle,
  pressedItem,
  pressedPaper,
  releasedPointer,
} from './Gestures.ts'

// UPDATE

type ReturnWithOut = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>
type Step = Update.Step<Model, Message, Services>

const foldDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.drop),
  write: (model: Model, drop: FileDrop.Model) => modifyFields(model, { drop: () => drop }),
  toParentMessage: (message: FileDrop.Message) => Message.GotDropMessage({ message }),
  foldOutMessage: FileDrop.OutMessage.match<Step>({
    ReceivedFiles:
      ({ files }) =>
      (model) =>
        picturesChosen(model, files),
    RejectedNonFiles: () => (model) => ({ model }),
  }),
})

/** The Add sheet's choice goes on the table: a piece, a look's pieces (the board pins the look), a picture pinned here,
 * or a Gallery photo or a try-on sent up as a picture that lands when the board holds it. */
const foldAddSheet = Update.foldChild({
  update: AddSheet.update,
  read: (model: Model) => Option.some(model.addSheet),
  write: (model: Model, addSheet: AddSheet.Model) => modifyFields(model, { addSheet: () => addSheet }),
  toParentMessage: (message: AddSheet.Message) => Message.GotAddSheetMessage({ message }),
  foldOutMessage: AddSheet.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
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
      (model) => ({
        ...addedPieces(
          model,
          look.pieces.map((piece) => piece.id),
        ),
        outMessage: OutMessage.PlacedLook({ lookId: look.id }),
      }),
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

/** Tidy, from the board's ⋯ sheet: the table laid out afresh, as one undo step. */
export const tidy = (model: Model): UpdateReturn => committed(model, model.items, tidied(model.items))

/** Paste, from the board's ⋯ sheet, asks the browser for the clipboard's pictures; a phone's browser shares them only
 * on a tap. */
export const paste = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { upload: (upload) => Upload.Pasting({ problem: uploadProblem(upload) }) }),
  commands: [ReadClipboard()],
})

/** Save as a look's first tap: every piece on the table ticked, for the person to leave some out. */
const selectionStarted = (model: Model): UpdateReturn => ({
  model: modifyFields(model, {
    ticks: () => Ticks.On({ itemIds: model.items.filter(Schema.is(PieceItem)).map((item) => item.id) }),
    maybeSelectedId: () => Option.none(),
  }),
})

/** The table's own steps, from the pointer, the keys and its tools. */
const tableSteps = (model: Model) =>
  ({
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
  }) satisfies Partial<{
    readonly [Tag in Message['_tag']]: (message: Extract<Message, { readonly _tag: Tag }>) => UpdateReturn
  }>

export const update = (model: Model, message: Message): ReturnWithOut =>
  Message.match<ReturnWithOut>(message, {
    ...tableSteps(model),
    CompletedMakeIds: ({ ids }) => ({ model: modifyFields(model, { ids: (pool) => [...pool, ...ids] }) }),
    MeasuredPaper: ({ width }) => ({ model: modifyFields(model, { pxPerUnit: () => unitsPerPixel(width) }) }),
    SelectedPaper: ({ paper }) => ({ model, outMessage: OutMessage.ChosePaper({ paper }) }),
    ElapsedSaveWait: ({ generation }) => saveNow(model, generation),
    SucceededSaveItems: ({ board }) => ({ ...saved(model, board), outMessage: OutMessage.SavedTable({ board }) }),
    FailedSaveItems: () => ({ model: modifyFields(model, { saving: () => Saving.Failed() }) }),
    ReplacedByNewerBoard: ({ board }) => ({
      ...replaced(model, board),
      outMessage: OutMessage.ReplacedTable({ board }),
    }),
    GotDropMessage: (got) => foldDrop(model, got.message),
    PastedFiles: ({ files }) => picturesChosen(model, files),
    DroppedFiles: ({ files }) => picturesChosen(modifyFields(model, { isDropping: () => false }), files),
    DraggedFilesOver: () => (model.isDropping ? { model } : { model: modifyFields(model, { isDropping: () => true }) }),
    EndedFileDrag: () => ({ model: modifyFields(model, { isDropping: () => false }) }),
    CompletedReadClipboard: ({ files }) => picturesChosen(model, files),
    SucceededAddImage: ({ imageId, image }) => addedImage(model, imageId, image),
    FailedAddImage: ({ problem }) => imageFailed(model, problem),
    GotAddSheetMessage: (got) => foldAddSheet(model, got.message),
    ClickedCancelSelecting: () => ({ model: modifyFields(model, { ticks: () => Ticks.Off() }) }),
    ToggledTick: ({ id }) => tickToggled(model, id),
    ClickedSaveLook: ({ name }) =>
      Ticks.guards.On(model.ticks) ? lookRequested(model, name) : selectionStarted(model),
    SucceededSaveLook: ({ lookId, board }) => ({
      model: modifyFields(model, { look: () => LookSave.Saved({ lookId }) }),
      outMessage: OutMessage.SavedLook({ board }),
    }),
    FailedSaveLook: () => ({ model: modifyFields(model, { look: () => LookSave.Failed() }) }),
  })
