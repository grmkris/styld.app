import { FileDrop } from '@foldkit/ui'
import { Board, BoardImage, BoardItemId, LookId, Paper, TextStyle } from '@styld/protocol'
import { Schema } from 'effect'
import { File } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import * as AddSheet from '../AddSheet.ts'
import { UploadProblem } from './Model.ts'
import { Pointer } from '../Geometry.ts'

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
  CompletedMakeIds: { ids: Schema.Array(BoardItemId) },
  MeasuredPaper: { width: Schema.Number },

  PressedItem: { id: BoardItemId, pointer: Pointer, isTouch: Schema.Boolean },
  /** The corner handle, with the item's centre on the page: the reach from it sets size and turn. */
  PressedHandle: { id: BoardItemId, pointer: Pointer, centerX: Schema.Number, centerY: Schema.Number },
  PressedPaper: { pointer: Pointer },
  MovedPointer: { pointer: Pointer },
  ReleasedPointer: { pointerId: Schema.Number },
  FocusedItem: { id: BoardItemId },
  PressedItemKey: { id: BoardItemId, step: KeyStep, isShifted: Schema.Boolean },
  PressedUndoKey: {},
  PressedRedoKey: {},
  PressedEscape: {},

  ClickedUndo: {},
  ClickedRedo: {},
  ClickedAddText: { text: Schema.String },
  ClickedFlip: { id: BoardItemId },
  ClickedDuplicate: { id: BoardItemId },
  ClickedLayer: { id: BoardItemId },
  ClickedRemove: { id: BoardItemId },
  ClickedUndoRemove: {},
  ElapsedToast: { generation: Schema.Int },
  CompletedExit: { id: BoardItemId },
  UpdatedText: { id: BoardItemId, text: Schema.String },
  SelectedTextStyle: { id: BoardItemId, style: TextStyle },
  SelectedPaper: { paper: Paper },

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

  GotAddSheetMessage: { message: AddSheet.Message },

  ClickedCancelSelecting: {},
  ToggledTick: { id: BoardItemId },
  /** Save as a look, from the board named `name`, which the look takes. */
  ClickedSaveLook: { name: Schema.String },
  SucceededSaveLook: { lookId: LookId, board: Board },
  FailedSaveLook: {},
})
export type Message = typeof Message.Type

/** What the board hears from its editor: the server's word on a saved table, a newer table saved elsewhere or a saved
 * look (each brings the board's pins), a paper chosen, and a look put on the table to pin. */
export const OutMessage = defineMessageUnion({
  SavedTable: { board: Board },
  ReplacedTable: { board: Board },
  SavedLook: { board: Board },
  ChosePaper: { paper: Paper },
  PlacedLook: { lookId: LookId },
})
export type OutMessage = typeof OutMessage.Type
