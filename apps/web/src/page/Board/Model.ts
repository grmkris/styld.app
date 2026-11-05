import { Board, CheckStatus, Paper, Pin, PublicBoard, Visibility } from '@styld/protocol'
import * as People from '../People.ts'
import * as TryIt from './TryIt.ts'
import * as Editor from './Editor/Model.ts'
import * as Chrome from './Chrome.ts'
import * as Share from '../Share.ts'
import { Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { LoadError } from '../../ServerData.ts'
import * as Make from './Make.ts'
import * as Outfits from './Outfits.ts'

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

/** Pinning from the picker, or taking a pin off the board. */
export const PinWork = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })
export type PinWork = typeof PinWork.Type

export const Model = Schema.Struct({
  boardId: Schema.String,
  board: BoardData.schema,
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
  /** Its table, edited in place. */
  editor: Editor.Model,
  /** Saving and reporting it, when it is someone else's. */
  people: People.Model,
  /** Trying it with the visitor's own wardrobe, when it shows generated pieces. */
  tryIt: TryIt.Model,
  /** Share on the owner's public board: the link shared or copied. */
  sharing: Share.Model,
  /** Make with Styld: a mood board or one picture from the person's words, and how it is going. */
  make: Make.Model,
  /** A "One piece, many outfits" board's outfits as cards (T-10), none on a blank board. */
  outfits: Outfits.Model,
})
export type Model = typeof Model.Type

export const init = (boardId: string): Model => ({
  boardId,
  board: AsyncData.Loading(),
  pins: [],
  pinWork: PinWork.Idle(),
  publicPins: [],
  visibility: 'private',
  check: Option.none(),
  chrome: Chrome.init(boardId),
  editor: Editor.init(boardId),
  people: People.init(People.Subject.Board({ boardId })),
  tryIt: TryIt.init(),
  sharing: Share.init,
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
    editor: (editor) => Editor.withTable(editor, board),
    pins: () => board.pins,
    outfits: (outfits) => Outfits.withBoard(outfits, board),
  })

/** Pin changes replace the saved table, so wait for every local edit and upload to settle first. */
export const canChangePins = (model: Model): boolean =>
  Editor.isSettled(model.editor) && !PinWork.guards.Sending(model.pinWork)
