import { FileDrop } from '@foldkit/ui'
import { type Board, BoardItem, BoardItemId, LookId } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import * as AddSheet from '../AddSheet.ts'
import { Pointer } from '../Geometry.ts'

// The board's editor: its table of items as the person moves, adds, changes and takes them off, with undo, saving
// behind the editing, the pictures sent to it, the Add sheet that puts things on it and saving a look from it. The
// board page holds it beside its name, pins and sharing, and hears from it what the server answered.

// MODEL

/** The person's hands on the table: nothing, one pointer moving an item, two fingers pinching it, or the
 * corner handle resizing and turning it. Each gesture keeps the table as it was, for Escape and undo. */
export const Gesture = defineTaggedUnion({
  Idle: {},
  Dragging: {
    id: BoardItemId,
    isTouch: Schema.Boolean,
    start: Pointer,
    now: Pointer,
    from: BoardItem,
    before: Schema.Array(BoardItem),
  },
  Pinching: {
    id: BoardItemId,
    startA: Pointer,
    startB: Pointer,
    a: Pointer,
    b: Pointer,
    from: BoardItem,
    before: Schema.Array(BoardItem),
  },
  Turning: {
    id: BoardItemId,
    reachX: Schema.Number,
    reachY: Schema.Number,
    start: Pointer,
    from: BoardItem,
    before: Schema.Array(BoardItem),
  },
})
export type Gesture = typeof Gesture.Type

/** Saving runs behind the editing: a change waits a moment for the next, then the whole table goes up. */
export const Saving = defineTaggedUnion({
  Saved: {},
  /** A change is waiting; only the newest wait saves. */
  Waiting: { generation: Schema.Int },
  InFlight: { dirty: Schema.Boolean },
  Failed: {},
  /** Someone saved this board elsewhere; the editor shows the newer table. */
  Replaced: {},
})
export type Saving = typeof Saving.Type

/** Why a picture did not reach the board: the file was refused, or it did not get through. */
export const UploadProblem = Schema.Literals(['refused', 'failed'])
export type UploadProblem = typeof UploadProblem.Type

/** Pictures on their way to the board, with the last that did not reach it; once none is on its way, a failure among
 * them is what the board says. Paste reads the clipboard first (a phone's browser shares it only on a tap), keeping
 * the failure it found, which stays if the clipboard holds no picture. */
export const Upload = defineTaggedUnion({
  Idle: {},
  Pasting: { problem: Schema.Option(UploadProblem) },
  Sending: { count: Schema.Int, problem: Schema.Option(UploadProblem) },
  Failed: { problem: UploadProblem },
})

/** The failure the board says, when it says one. */
export const uploadProblem = (upload: Upload): Option.Option<UploadProblem> =>
  Upload.match(upload, {
    Idle: () => Option.none(),
    Pasting: ({ problem }) => problem,
    Sending: () => Option.none(),
    Failed: ({ problem }) => Option.some(problem),
  })

/** Whether pictures are being read or sent, so another paste or a pin change waits. */
export const isUploading = (upload: Upload): boolean => Upload.guards.Pasting(upload) || Upload.guards.Sending(upload)
export type Upload = typeof Upload.Type

export const LookSave = defineTaggedUnion({
  Idle: {},
  Saving: {},
  Saved: { lookId: LookId },
  Failed: {},
  NoPieces: {},
})
export type LookSave = typeof LookSave.Type

/** Select mode (T-16): taps tick items for a look instead of moving them, and what is ticked, by item id. */
export const Ticks = defineTaggedUnion({ Off: {}, On: { itemIds: Schema.Array(BoardItemId) } })
export type Ticks = typeof Ticks.Type

/** "Removed. Undo": the table as it was before the removal, offered back for a few seconds. */
export const Toast = defineTaggedUnion({
  Hidden: {},
  Removed: { generation: Schema.Int, before: Schema.Array(BoardItem) },
})
export type Toast = typeof Toast.Type

export const Model = Schema.Struct({
  boardId: Schema.String,
  version: Schema.Int,
  items: Schema.Array(BoardItem),
  /** The Add sheet: what can go on the table, and the kind of thing it offers. */
  addSheet: AddSheet.Model,
  /** Items on their way out, kept on the page until their exit animation ends. */
  leaving: Schema.Array(BoardItem),
  maybeSelectedId: Schema.Option(BoardItemId),
  ticks: Ticks,
  gesture: Gesture,
  /** How many page pixels one table unit is; the paper reports its width. */
  pxPerUnit: Schema.Number,
  past: Schema.Array(Schema.Array(BoardItem)),
  future: Schema.Array(Schema.Array(BoardItem)),
  saving: Saving,
  generation: Schema.Int,
  /** Fresh item ids, made by a Command ahead of time so adding an item is instant. */
  ids: Schema.Array(BoardItemId),
  upload: Upload,
  look: LookSave,
  toast: Toast,
  /** Files are being dragged over the page: the table shows it takes them. */
  isDropping: Schema.Boolean,
  drop: FileDrop.Model,
})
export type Model = typeof Model.Type

export const init = (boardId: string): Model => ({
  boardId,
  version: 0,
  items: [],
  addSheet: AddSheet.init(),
  leaving: [],
  maybeSelectedId: Option.none(),
  ticks: Ticks.Off(),
  gesture: Gesture.Idle(),
  pxPerUnit: 0.36,
  past: [],
  future: [],
  saving: Saving.Saved(),
  generation: 0,
  ids: [],
  upload: Upload.Idle(),
  look: LookSave.Idle(),
  toast: Toast.Hidden(),
  isDropping: false,
  drop: FileDrop.init({ id: 'board-pictures' }),
})

/** The table as the server last confirmed it. */
export const withTable = (model: Model, board: Board): Model =>
  modifyFields(model, { version: () => board.version, items: () => board.items })

/** A table saved elsewhere replaces this one with a fresh history and nothing selected. */
export const restarted = (model: Model, board: Board): Model =>
  modifyFields(withTable(model, board), {
    past: () => [],
    future: () => [],
    maybeSelectedId: () => Option.none(),
  })

/** Nothing being changed or saved here: a board read again may replace the table. */
export const isQuiet = (model: Model): boolean =>
  Saving.guards.Saved(model.saving) && Gesture.guards.Idle(model.gesture)

/** Every local edit and upload settled, so a pin change may replace the saved table. */
export const isSettled = (model: Model): boolean =>
  (Saving.guards.Saved(model.saving) || Saving.guards.Replaced(model.saving)) &&
  Gesture.guards.Idle(model.gesture) &&
  !isUploading(model.upload)

/** Whether a sheet of the editor's covers the table, so its keys and hands are the sheet's. */
export const isCovered = (model: Model): boolean => AddSheet.isSheetShown(model.addSheet)
