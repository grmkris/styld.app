import { Dialog, FileDrop } from '@foldkit/ui'
import {
  Board,
  BoardImageId,
  BoardItemId,
  Look,
  LookId,
  Mood,
  Paper,
  PinId,
  PublicBoard,
  TextStyle,
} from '@styld/protocol'
import * as People from '../People.ts'
import * as WardrobePage from '../Wardrobe.ts'
import { Schema } from 'effect'
import { File } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { Pointer } from './Geometry.ts'

// MESSAGE

/** A step the keyboard asks of the selected item. */
export const KeyStep = Schema.Literals([
  'left',
  'right',
  'up',
  'down',
  'bigger',
  'smaller',
  'turnLeft',
  'turnRight',
  'remove',
])
export type KeyStep = typeof KeyStep.Type

export const Message = defineMessageUnion({
  SucceededLoadBoard: { board: Board },
  FailedLoadBoard: { missing: Schema.Boolean },
  SucceededVisitBoard: { board: PublicBoard },
  GotWardrobeMessage: { message: WardrobePage.Message },
  CompletedMakeIds: { ids: Schema.Array(BoardItemId) },
  MeasuredPaper: { width: Schema.Number },

  PressedItem: { id: Schema.String, pointer: Pointer, isTouch: Schema.Boolean },
  /** The corner handle, with the item's centre on the page: the reach from it sets size and turn. */
  PressedHandle: { id: Schema.String, pointer: Pointer, centerX: Schema.Number, centerY: Schema.Number },
  PressedPaper: { pointer: Pointer },
  MovedPointer: { pointer: Pointer },
  ReleasedPointer: { pointerId: Schema.Number },
  FocusedItem: { id: Schema.String },
  PressedItemKey: { id: Schema.String, step: KeyStep, isShifted: Schema.Boolean },
  PressedUndoKey: {},
  PressedRedoKey: {},
  PressedEscape: {},

  ClickedUndo: {},
  ClickedRedo: {},
  ClickedTidy: {},
  ClickedAddText: { text: Schema.String },
  ClickedWardrobePiece: { pieceId: Schema.String },
  ClickedPinnedPicture: { imageId: BoardImageId },
  ClickedFlip: { id: Schema.String },
  ClickedDuplicate: { id: Schema.String },
  ClickedForward: { id: Schema.String },
  ClickedBackward: { id: Schema.String },
  ClickedRemove: { id: Schema.String },
  ClickedUndoRemove: {},
  ElapsedToast: { generation: Schema.Int },
  CompletedExit: { id: Schema.String },
  UpdatedText: { id: Schema.String, text: Schema.String },
  SelectedTextStyle: { id: Schema.String, style: TextStyle },
  SelectedPaper: { paper: Paper },
  SucceededUpdateBoard: { board: Board },
  FailedUpdateBoard: {},

  ElapsedSaveWait: { generation: Schema.Int },
  SucceededSaveItems: { board: Board },
  FailedSaveItems: {},
  ReplacedByNewerBoard: { board: Board },

  GotDropMessage: { message: FileDrop.Message },
  PastedFiles: { files: Schema.Array(File.File) },
  DroppedFiles: { files: Schema.Array(File.File) },
  DraggedFilesOver: {},
  EndedFileDrag: {},
  ClickedPaste: {},
  CompletedReadClipboard: { files: Schema.Array(File.File) },
  SucceededAddImage: { imageId: BoardImageId },
  FailedAddImage: { refused: Schema.Boolean },

  /** The page came back into view: another device or an assistant may have changed the board. */
  BecameVisible: {},
  SucceededReloadBoard: { board: Board },
  FailedReloadBoard: {},

  ClickedSettings: {},
  GotSettingsMessage: { message: Dialog.Message },
  UpdatedNameDraft: { value: Schema.String },
  SubmittedRename: {},
  SucceededRename: { board: Board },
  FailedRename: {},
  ToggledPublic: { isPublic: Schema.Boolean },
  GotPeopleMessage: { message: People.Message },
  ToggledMood: { mood: Mood },
  SucceededSetMoods: { board: Board },
  FailedSetMoods: {},
  SucceededSetVisibility: { board: Board },
  FailedSetVisibility: { needsProfile: Schema.Boolean },
  ClickedDeleteBoard: {},
  ClickedKeepBoard: {},
  ClickedConfirmDelete: {},
  SucceededDeleteBoard: {},
  FailedDeleteBoard: {},
  CompletedLeaveBoard: {},

  ClickedUnpin: { pinId: PinId },
  ClickedAddPins: {},
  GotPickerMessage: { message: Dialog.Message },
  ToggledPick: { pick: Schema.String },
  SubmittedPicks: {},
  SucceededLoadLooks: { looks: Schema.Array(Look) },
  FailedLoadLooks: {},
  SucceededPins: { board: Board },
  FailedPins: {},

  ClickedSaveLook: {},
  SucceededSaveLook: { lookId: LookId },
  FailedSaveLook: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type
