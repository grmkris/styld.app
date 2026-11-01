import { FileDrop } from '@foldkit/ui'
import { tidied } from '@styld/protocol'
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
  placedPicture,
  removed,
  styleSelected,
  textUpdated,
  toastElapsed,
  undoRemove,
} from './Actions.ts'
import { LoadBoard, MakeIds, ReadClipboard, unitsPerPixel, VisitBoard } from './Commands.ts'
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
import { BoardState, fromBoard, LookSave, type Model, Saving, Upload } from './Model.ts'
import { pageSteps } from './Page.ts'
import * as People from '../People.ts'
import * as Make from './Make.ts'
import { readShown, ReloadBoard } from './PageCommands.ts'

/** The Commands that open the board: the board and a first batch of ids (the app reads the pieces for the tray).
 * Signed out it can only be someone's public board, read as visitors read it, with nothing to edit. */
export const load = (model: Model): ReadonlyArray<Command.Command<Message, never, Services>> =>
  model.signedIn ? [LoadBoard({ boardId: model.boardId }), MakeIds()] : [VisitBoard({ boardId: model.boardId })]

const foldPeople = People.foldInto<Model, Message>((message) => Message.GotPeopleMessage({ message }))

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
    SucceededLoadBoard: ({ board }) => {
      const next = fromBoard(model, board)
      return {
        model: next,
        commands: [
          ...Command.mapMessages(Make.resume(model.make), (made) => Message.GotMakeMessage({ message: made })),
          ...readShown(next),
        ],
      }
    },
    FailedLoadBoard: ({ missing }) => loadFailed(model, missing),
    SucceededVisitBoard: ({ board }) => ({
      model: modifyFields(model, { board: () => BoardState.Visiting({ board }) }),
    }),
    GotPeopleMessage: (got) => foldPeople(model, got.message),
    GotMakeMessage: (got) => foldMake(model, got.message),
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
    ClickedPinnedPicture: ({ imageId }) => placedPicture(model, imageId),
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
    ...pageSteps(model),
    ClickedSaveLook: () => lookRequested(model),
    SucceededSaveLook: ({ lookId }) => ({ model: modifyFields(model, { look: () => LookSave.Saved({ lookId }) }) }),
    FailedSaveLook: () => ({ model: modifyFields(model, { look: () => LookSave.Failed() }) }),
    ClickedRetry: () => ({ model: modifyFields(model, { board: () => BoardState.Loading() }), commands: load(model) }),
  })
