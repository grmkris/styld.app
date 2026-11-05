import { FileDrop } from '@foldkit/ui'
import { Board, BoardImage, BoardItemId, LookId, Paper, PublicBoard, TextStyle } from '@styld/protocol'
import * as AddSheet from './AddSheet.ts'
import * as Chrome from './Chrome.ts'
import * as Make from './Make.ts'
import * as Outfits from './Outfits.ts'
import * as People from '../People.ts'
import * as TryIt from './TryIt.ts'
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
  ClickedAddText: { text: Schema.String },
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
  CompletedReadClipboard: { files: Schema.Array(File.File) },
  SucceededAddImage: BoardImage.fields,
  FailedAddImage: { problem: UploadProblem },

  /** The page came back into view: another device or an assistant may have changed the board. */
  BecameVisible: {},
  CompletedReloadBoard: { maybeBoard: Schema.Option(Board) },

  GotPeopleMessage: { message: People.Message },
  GotTryItMessage: { message: TryIt.Message },
  GotShareMessage: { message: Share.Message },
  GotMakeMessage: { message: Make.Message },
  GotOutfitsMessage: { message: Outfits.Message },
  GotAddSheetMessage: { message: AddSheet.Message },
  GotChromeMessage: { message: Chrome.Message },

  /** A look put on the table is pinned too; the table is the page's, so only the pins come back. */
  CompletedPinLook: { maybeBoard: Schema.Option(Board) },
  SucceededPins: { board: Board },
  FailedPins: {},

  ClickedCancelSelecting: {},
  ToggledTick: { id: Schema.String },
  ClickedSaveLook: {},
  SucceededSaveLook: { lookId: LookId, board: Board },
  FailedSaveLook: {},
  ClickedRetry: {},
})
export type Message = typeof Message.Type
