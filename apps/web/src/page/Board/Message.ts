import { Dialog, FileDrop } from '@foldkit/ui'
import {
  Board,
  BoardImage,
  GarmentGroup,
  PieceType,
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
import * as Make from './Make.ts'
import * as Outfits from './Outfits.ts'
import * as People from '../People.ts'
import * as Share from '../Share.ts'
import { Schema } from 'effect'
import { File } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { LoadError } from '../../ServerData.ts'
import { Pointer } from './Geometry.ts'
import { UploadProblem } from './Model.ts'

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
  FailedLoadBoard: { error: LoadError },
  SucceededVisitBoard: { board: PublicBoard },
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
  ClickedLayer: { id: Schema.String },
  ClickedRemove: { id: Schema.String },
  ClickedUndoRemove: {},
  ElapsedToast: { generation: Schema.Int },
  CompletedExit: { id: Schema.String },
  UpdatedText: { id: Schema.String, text: Schema.String },
  SelectedTextStyle: { id: Schema.String, style: TextStyle },
  SelectedPaper: { paper: Paper },
  SucceededUpdatePaper: { board: Board },
  FailedUpdatePaper: { attempted: Paper, previous: Paper },

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
  SucceededAddImage: BoardImage.fields,
  FailedAddImage: { problem: UploadProblem },

  /** The page came back into view: another device or an assistant may have changed the board. */
  BecameVisible: {},
  CompletedReloadBoard: { maybeBoard: Schema.Option(Board) },

  ClickedSettings: {},
  GotSettingsMessage: { message: Dialog.Message },
  UpdatedNameDraft: { value: Schema.String },
  SubmittedRename: {},
  SucceededRename: { board: Board },
  FailedRename: {},
  ToggledPublic: { isPublic: Schema.Boolean },
  GotPeopleMessage: { message: People.Message },
  GotShareMessage: { message: Share.Message },
  GotMakeMessage: { message: Make.Message },
  GotOutfitsMessage: { message: Outfits.Message },
  ToggledMood: { mood: Mood },
  SucceededSetBoardMoods: { board: Board },
  FailedSetBoardMoods: { attempted: Schema.Array(Mood), previous: Schema.Array(Mood) },
  SucceededSetVisibility: { board: Board },
  FailedSetVisibility: { needsProfile: Schema.Boolean },
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
  ClickedAddPins: {},
  ClickedAddYourPiece: {},
  GotPiecePickerMessage: { message: Dialog.Message },
  SelectedPickerGroup: { group: Schema.Option(GarmentGroup) },
  SelectedPickerType: { type: Schema.Option(PieceType) },
  GotPickerMessage: { message: Dialog.Message },
  ToggledPick: { pick: Schema.String },
  SubmittedPicks: {},
  SucceededLoadLooks: { looks: Schema.Array(Look) },
  FailedLoadLooks: {},
  SucceededPins: { board: Board },
  FailedPins: {},

  ClickedSelect: {},
  ClickedDoneSelecting: {},
  ToggledTick: { id: Schema.String },
  ClickedSaveLook: {},
  SucceededSaveLook: { lookId: LookId, board: Board },
  FailedSaveLook: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type
