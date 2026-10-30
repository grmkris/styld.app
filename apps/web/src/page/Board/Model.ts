import { Dialog, FileDrop } from '@foldkit/ui'
import { Board, BoardItem, BoardItemId, Look, LookId, Paper, Pin } from '@styld/protocol'
import * as WardrobePage from '../Wardrobe.ts'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { Pointer } from './Geometry.ts'

// MODEL

/** What the editor knows about the board itself. */
export const BoardState = defineTaggedUnion({
  Loading: {},
  Failed: {},
  Missing: {},
  Ready: { name: Schema.String, paper: Paper },
})
export type BoardState = typeof BoardState.Type

/** The person's hands on the table: nothing, one pointer moving an item, two fingers pinching it, or the
 * corner handle resizing and turning it. Each gesture keeps the table as it was, for Escape and undo. */
export const Gesture = defineTaggedUnion({
  Idle: {},
  Dragging: {
    id: Schema.String,
    isTouch: Schema.Boolean,
    start: Pointer,
    now: Pointer,
    from: BoardItem,
    before: Schema.Array(BoardItem),
  },
  Pinching: {
    id: Schema.String,
    startA: Pointer,
    startB: Pointer,
    a: Pointer,
    b: Pointer,
    from: BoardItem,
    before: Schema.Array(BoardItem),
  },
  Turning: {
    id: Schema.String,
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

/** Pictures on their way to the board. */
export const Upload = defineTaggedUnion({
  Idle: {},
  Sending: { count: Schema.Int },
  Failed: { refused: Schema.Boolean },
})
export type Upload = typeof Upload.Type

export const LookSave = defineTaggedUnion({
  Idle: {},
  Saving: {},
  Saved: { lookId: LookId },
  Failed: {},
  NoPieces: {},
})
export type LookSave = typeof LookSave.Type

/** Pinning from the picker, or taking a pin off the board. */
export const PinWork = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })
export type PinWork = typeof PinWork.Type

/** Renaming the board from its settings. */
export const Rename = defineTaggedUnion({ Idle: {}, Saving: {}, Failed: {} })
export type Rename = typeof Rename.Type

/** Deleting the board: asked once more, then sent. */
export const Removal = defineTaggedUnion({ Idle: {}, Confirming: {}, Deleting: {}, Failed: {} })
export type Removal = typeof Removal.Type

/** The person's looks, for the picker. */
export const LooksData = AsyncData.Schema(Schema.Array(Look), Schema.Literal('Unavailable'))
export type LooksData = typeof LooksData.schema.Type

/** "Removed. Undo": the table as it was before the removal, offered back for a few seconds. */
export const Toast = defineTaggedUnion({
  Hidden: {},
  Removed: { generation: Schema.Int, before: Schema.Array(BoardItem) },
})
export type Toast = typeof Toast.Type

export const Model = Schema.Struct({
  boardId: Schema.String,
  board: BoardState,
  version: Schema.Int,
  items: Schema.Array(BoardItem),
  /** What is pinned on the board, newest first. */
  pins: Schema.Array(Pin),
  pinWork: PinWork,
  /** The settings sheet: the name being typed, a rename and a deletion. */
  settings: Dialog.Model,
  nameDraft: Schema.String,
  rename: Rename,
  removal: Removal,
  /** The sheet that pins pieces and looks, and what is ticked in it (`piece:<id>`, `look:<id>`). */
  picker: Dialog.Model,
  picks: Schema.Array(Schema.String),
  looks: LooksData.schema,
  /** Items on their way out, kept on the page until their exit animation ends. */
  leaving: Schema.Array(BoardItem),
  maybeSelectedId: Schema.Option(Schema.String),
  gesture: Gesture,
  /** How many page pixels one table unit is; the paper reports its width. */
  pxPerUnit: Schema.Number,
  past: Schema.Array(Schema.Array(BoardItem)),
  future: Schema.Array(Schema.Array(BoardItem)),
  saving: Saving,
  generation: Schema.Int,
  /** Fresh item ids, made by a Command ahead of time so adding an item is instant. */
  ids: Schema.Array(BoardItemId),
  /** The person's pieces for the tray, through the wardrobe page's own model. */
  wardrobe: WardrobePage.Model,
  upload: Upload,
  look: LookSave,
  toast: Toast,
  isPasting: Schema.Boolean,
  /** Files are being dragged over the page: the table shows it takes them. */
  isDropping: Schema.Boolean,
  drop: FileDrop.Model,
})
export type Model = typeof Model.Type

export const init = (boardId: string): Model => ({
  boardId,
  board: BoardState.Loading(),
  version: 0,
  items: [],
  pins: [],
  pinWork: PinWork.Idle(),
  settings: Dialog.init({ id: 'board-settings' }),
  nameDraft: '',
  rename: Rename.Idle(),
  removal: Removal.Idle(),
  picker: Dialog.init({ id: 'board-picker' }),
  picks: [],
  looks: AsyncData.Idle(),
  leaving: [],
  maybeSelectedId: Option.none(),
  gesture: Gesture.Idle(),
  pxPerUnit: 0.36,
  past: [],
  future: [],
  saving: Saving.Saved(),
  generation: 0,
  ids: [],
  wardrobe: WardrobePage.init(),
  upload: Upload.Idle(),
  look: LookSave.Idle(),
  toast: Toast.Hidden(),
  isPasting: false,
  isDropping: false,
  drop: FileDrop.init({ id: 'board-pictures' }),
})

/** The board as the server last confirmed it. */
export const fromBoard = (model: Model, board: Board): Model =>
  modifyFields(model, {
    board: () => BoardState.Ready({ name: board.name, paper: board.paper }),
    version: () => board.version,
    items: () => board.items,
    pins: () => board.pins,
  })
