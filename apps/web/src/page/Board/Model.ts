import { FileDrop } from '@foldkit/ui'
import {
  Board,
  BoardItem,
  BoardItemId,
  CheckStatus,
  LookId,
  Paper,
  Pin,
  PublicBoard,
  Visibility,
} from '@styld/protocol'
import * as People from '../People.ts'
import * as TryIt from './TryIt.ts'
import * as AddSheet from './AddSheet.ts'
import * as Chrome from './Chrome.ts'
import * as Share from '../Share.ts'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { LoadError } from '../../ServerData.ts'
import * as Make from './Make.ts'
import * as Outfits from './Outfits.ts'
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

/** Pinning from the picker, or taking a pin off the board. */
export const PinWork = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })
export type PinWork = typeof PinWork.Type

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
  /** The pins visitors see while the board is public, as the server says: a piece shows others only with a picture of
   * its own and once Styld's check lets it, so it can be fewer than are pinned. */
  publicPins: Schema.Array(Schema.String),
  /** Who sees the board, and Styld's check of it once it has been public. */
  visibility: Visibility,
  check: Schema.Option(CheckStatus),
  /** Its title, its public switch and its ⋯ sheet. */
  chrome: Chrome.Model,
  /** Saving and reporting it, when it is someone else's. */
  people: People.Model,
  /** Trying it with the visitor's own wardrobe, when it shows generated pieces. */
  tryIt: TryIt.Model,
  /** Share on the owner's public board: the link shared or copied. */
  sharing: Share.Model,
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
  /** Make with Styld: a mood board or one picture from the person's words, and how it is going. */
  make: Make.Model,
  /** A "One piece, many outfits" board's outfits as cards (T-10), none on a blank board. */
  outfits: Outfits.Model,
})
export type Model = typeof Model.Type

export const init = (boardId: string): Model => ({
  boardId,
  board: AsyncData.Loading(),
  version: 0,
  items: [],
  pins: [],
  pinWork: PinWork.Idle(),
  publicPins: [],
  visibility: 'private',
  check: Option.none(),
  chrome: Chrome.init(boardId),
  people: People.init(People.Subject.Board({ boardId })),
  tryIt: TryIt.init(),
  sharing: Share.init,
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
  make: Make.init(boardId),
  outfits: Outfits.init(boardId),
})

/** Who sees the board and which of its pins, and Styld's check of it, as the server last confirmed them. */
export const withChecked = (model: Model, board: Board): Model =>
  modifyFields(model, {
    visibility: () => board.visibility,
    publicPins: () => board.publicPins,
    check: () => Option.fromNullishOr(board.check),
  })

/** The board as the server last confirmed it: its name, paper, moods, visibility and check. */
export const withSharing = (model: Model, board: Board): Model =>
  modifyFields(withChecked(model, board), {
    board: () => BoardData.Success({ data: BoardShown.Own({ name: board.name, paper: board.paper }) }),
    chrome: (chrome) => Chrome.withMoods(chrome, board.moods),
  })

/** The board as the server last confirmed it. */
export const fromBoard = (model: Model, board: Board): Model =>
  modifyFields(withSharing(model, board), {
    version: () => board.version,
    items: () => board.items,
    pins: () => board.pins,
    outfits: (outfits) => Outfits.withBoard(outfits, board),
  })

/** Pin changes replace the saved table, so wait for every local edit and upload to settle first. */
export const canChangePins = (model: Model): boolean =>
  (Saving.guards.Saved(model.saving) || Saving.guards.Replaced(model.saving)) &&
  Gesture.guards.Idle(model.gesture) &&
  !PinWork.guards.Sending(model.pinWork) &&
  !isUploading(model.upload)
