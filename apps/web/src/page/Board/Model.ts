import { Dialog, FileDrop } from '@foldkit/ui'
import {
  Board,
  BoardItem,
  BoardItemId,
  CheckStatus,
  Look,
  LookId,
  Mood,
  Paper,
  Pin,
  PublicBoard,
  Visibility,
} from '@styld/protocol'
import * as People from '../People.ts'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import { Deletion } from '../../Confirm.ts'
import { modifyFields } from 'foldkit/struct'
import { LoadError } from '../../ServerData.ts'
import * as Make from './Make.ts'
import { Pointer } from './Geometry.ts'

// MODEL

/** The board as this page shows it: the person's own, by its name and paper, or someone else's public one (or the
 * person's own read signed out), shown as others see it. */
export const BoardShown = defineTaggedUnion({
  Own: { name: Schema.String, paper: Paper },
  Visiting: { board: PublicBoard },
})
export type BoardShown = typeof BoardShown.Type

/** The board as last read, or why it is not shown. */
export const BoardData = AsyncData.Schema(BoardShown, LoadError)
export type BoardData = typeof BoardData.schema.Type

/** The person's own board as shown: its name and paper. */
export const ownBoard = (board: BoardData): Option.Option<{ readonly name: string; readonly paper: Paper }> =>
  Option.flatMap(AsyncData.getData(board), (shown) =>
    BoardShown.guards.Own(shown) ? Option.some(shown) : Option.none(),
  )

/** The board's name, whoever's it is; empty until it is read. */
export const boardName = (board: BoardData): string =>
  Option.match(AsyncData.getData(board), {
    onNone: () => '',
    onSome: BoardShown.match({ Own: ({ name }) => name, Visiting: ({ board: shown }) => shown.name }),
  })

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

/** Why a picture did not reach the board: the file was refused, or it did not get through. */
export const UploadProblem = Schema.Literals(['refused', 'failed'])
export type UploadProblem = typeof UploadProblem.Type

/** Pictures on their way to the board, with the last that did not reach it; once none is on its way, a failure among
 * them is what the board says. */
export const Upload = defineTaggedUnion({
  Idle: {},
  Sending: { count: Schema.Int, problem: Schema.Option(UploadProblem) },
  Failed: { problem: UploadProblem },
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

/** Making the board public or private from its settings; a board goes public only from a published profile. */
export const Publishing = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: { needsProfile: Schema.Boolean } })
export type Publishing = typeof Publishing.Type

/** Deleting the board: asked once more, then sent. */
export const Removal = Deletion
export type Removal = Deletion

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
  board: BoardData.schema,
  version: Schema.Int,
  items: Schema.Array(BoardItem),
  /** What is pinned on the board, newest first. */
  pins: Schema.Array(Pin),
  pinWork: PinWork,
  /** The pins visitors see, read through the public page while the board is public: a piece shows others only with a
   * picture of its own and once Styld's check lets it, so it can be fewer than are pinned. */
  shownToOthers: Schema.Option(Schema.Array(Schema.String)),
  /** The pin whose × was pressed: it asks once more, since it comes off the table too (and a picture is deleted). */
  unpinning: Schema.Option(Schema.String),
  /** The settings sheet: the name being typed, a rename and a deletion. */
  settings: Dialog.Model,
  nameDraft: Schema.String,
  rename: Rename,
  removal: Removal,
  /** Who sees the board, and Styld's check of it once it has been public. */
  visibility: Visibility,
  check: Schema.Option(CheckStatus),
  publishing: Publishing,
  /** The board's moods for Explore, as last saved. */
  moods: Schema.Array(Mood),
  /** Saving and reporting it, when it is someone else's. */
  people: People.Model,
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
  upload: Upload,
  look: LookSave,
  toast: Toast,
  isPasting: Schema.Boolean,
  /** Files are being dragged over the page: the table shows it takes them. */
  isDropping: Schema.Boolean,
  drop: FileDrop.Model,
  /** Make with Styld: a mood board or one picture from the person's words, and how it is going. */
  make: Make.Model,
  /** A session came with the page; signed out the board can only be someone's public one. */
  signedIn: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (boardId: string, signedIn: boolean): Model => ({
  boardId,
  signedIn,
  board: AsyncData.Loading(),
  version: 0,
  items: [],
  pins: [],
  pinWork: PinWork.Idle(),
  unpinning: Option.none(),
  shownToOthers: Option.none(),
  settings: Dialog.init({ id: 'board-settings', isAnimated: true }),
  nameDraft: '',
  rename: Rename.Idle(),
  removal: Removal.Idle(),
  visibility: 'private',
  check: Option.none(),
  publishing: Publishing.Idle(),
  moods: [],
  people: People.init(People.Subject.Board({ boardId })),
  picker: Dialog.init({ id: 'board-picker', isAnimated: true }),
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
  upload: Upload.Idle(),
  look: LookSave.Idle(),
  toast: Toast.Hidden(),
  isPasting: false,
  isDropping: false,
  drop: FileDrop.init({ id: 'board-pictures' }),
  make: Make.init(boardId),
})

/** Who sees the board and Styld's check of it, as the server last confirmed them. */
export const withChecked = (model: Model, board: Board): Model =>
  modifyFields(model, { visibility: () => board.visibility, check: () => Option.fromNullishOr(board.check) })

/** The board as the server last confirmed it: its name, paper, moods, visibility and check. */
export const withSharing = (model: Model, board: Board): Model =>
  modifyFields(withChecked(model, board), {
    board: () => BoardData.Success({ data: BoardShown.Own({ name: board.name, paper: board.paper }) }),
    moods: () => board.moods,
  })

/** The board as the server last confirmed it. */
export const fromBoard = (model: Model, board: Board): Model =>
  modifyFields(withSharing(model, board), {
    version: () => board.version,
    items: () => board.items,
    pins: () => board.pins,
  })
