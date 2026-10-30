import { Schema } from 'effect'
import { CheckStatus, Visibility } from './Check.ts'
import { maximumMoods, Mood } from './Mood.ts'
import { Look, LookId } from './Look.ts'
import { OperationId, Piece, PieceId, UploadId } from './Wardrobe.ts'

/** Opaque ids: a kind prefix and 22 base64url characters (16 random bytes). The website makes item ids
 * itself, because items appear while the person edits and are saved together. */
export const BoardId = Schema.String.check(Schema.isPattern(/^bd_[A-Za-z0-9_-]{22}$/)).pipe(Schema.brand('BoardId'))
export type BoardId = typeof BoardId.Type
export const BoardItemId = Schema.String.check(Schema.isPattern(/^bi_[A-Za-z0-9_-]{22}$/)).pipe(
  Schema.brand('BoardItemId'),
)
export type BoardItemId = typeof BoardItemId.Type
export const BoardImageId = Schema.String.check(Schema.isPattern(/^bm_[A-Za-z0-9_-]{22}$/)).pipe(
  Schema.brand('BoardImageId'),
)
export type BoardImageId = typeof BoardImageId.Type
export const PinId = Schema.String.check(Schema.isPattern(/^pn_[A-Za-z0-9_-]{22}$/)).pipe(Schema.brand('PinId'))
export type PinId = typeof PinId.Type

/** A board's table is a sheet 1000 units across and 1250 down (4:5); placements are in those units. */
export const boardWidth = 1000
export const boardHeight = 1250
/** The most things one board's table holds. */
export const maximumBoardItems = 60
/** The most things pinned on one board, and the most one call pins or unpins. */
export const maximumBoardPins = 500
export const pinsAtOnce = 50
export const minimumItemSize = 40
export const maximumItemSize = 1200

/** The sheet's colour. */
export const Paper = Schema.Literals(['paper', 'stock', 'sand', 'sage', 'slate', 'clay'])
export type Paper = typeof Paper.Type

/** A text label's face: a plain label, or the headline in the logo's condensed voice. */
export const TextStyle = Schema.Literals(['label', 'headline'])
export type TextStyle = typeof TextStyle.Type

export const BoardName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60))
export const LabelText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(140))

/** Where a thing lies: its centre, its width, how far it is turned (degrees), its stacking and whether it is
 * mirrored. */
const placement = {
  id: BoardItemId,
  x: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: boardWidth })),
  y: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: boardHeight })),
  size: Schema.Finite.check(Schema.isBetween({ minimum: minimumItemSize, maximum: maximumItemSize })),
  turn: Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  z: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 })),
  flipped: Schema.Boolean,
}

/** One of the person's own pieces, shown as its cut-out. */
export const PieceItem = Schema.TaggedStruct('PieceItem', { ...placement, pieceId: PieceId })
export type PieceItem = typeof PieceItem.Type
/** A text label. */
export const TextItem = Schema.TaggedStruct('TextItem', { ...placement, text: LabelText, style: TextStyle })
export type TextItem = typeof TextItem.Type
/** A picture the person put on the board: pasted, dropped or chosen. */
export const ImageItem = Schema.TaggedStruct('ImageItem', { ...placement, imageId: BoardImageId })
export type ImageItem = typeof ImageItem.Type

export const BoardItem = Schema.Union([PieceItem, TextItem, ImageItem])
export type BoardItem = typeof BoardItem.Type

/** One of the person's pieces pinned on the board. */
export const PiecePin = Schema.TaggedStruct('PiecePin', { id: PinId, piece: Piece, addedAt: Schema.String })
export type PiecePin = typeof PiecePin.Type
/** A picture on the board: pasted, dropped or chosen. */
export const PicturePin = Schema.TaggedStruct('PicturePin', {
  id: PinId,
  imageId: BoardImageId,
  addedAt: Schema.String,
})
export type PicturePin = typeof PicturePin.Type
/** One of the person's looks pinned on the board. */
export const LookPin = Schema.TaggedStruct('LookPin', { id: PinId, look: Look, addedAt: Schema.String })
export type LookPin = typeof LookPin.Type

export const Pin = Schema.Union([PiecePin, PicturePin, LookPin])
export type Pin = typeof Pin.Type

/** A board: its pins, newest first, and its table, which places some of them. */
export const Board = Schema.Struct({
  id: BoardId,
  name: Schema.String,
  paper: Paper,
  /** Bumped by every save of the table; a save names the version it started from. Pinning leaves it. */
  version: Schema.Int,
  items: Schema.Array(BoardItem),
  pins: Schema.Array(Pin),
  /** Up to three moods, for Explore. */
  moods: Schema.Array(Mood),
  visibility: Visibility,
  /** The model's check, once the board has been public; others see it only while the check lets them. */
  check: Schema.NullOr(CheckStatus),
  updatedAt: Schema.String,
})
export type Board = typeof Board.Type

/** A board in a list: its table, its newest pins for a cover and how many it holds. */
export const BoardSummary = Schema.Struct({
  id: BoardId,
  name: Schema.String,
  paper: Paper,
  items: Schema.Array(BoardItem),
  cover: Schema.Array(Pin),
  pinCount: Schema.Int,
  visibility: Visibility,
  updatedAt: Schema.String,
})
export type BoardSummary = typeof BoardSummary.Type

export const Boards = Schema.Struct({ boards: Schema.Array(BoardSummary) })

export const CreateBoard = Schema.Struct({ operationId: OperationId, name: BoardName })
export type CreateBoard = typeof CreateBoard.Type

export const UpdateBoard = Schema.Struct({
  name: Schema.optionalKey(BoardName),
  paper: Schema.optionalKey(Paper),
  /** Up to three moods, for Explore. */
  moods: Schema.optionalKey(Schema.Array(Mood).check(Schema.isMaxLength(maximumMoods))),
})
export type UpdateBoard = typeof UpdateBoard.Type

/** The whole table, replacing what was saved, from the version the editor started with. Pieces it places are
 * pinned on the board too. */
export const SaveBoardItems = Schema.Struct({
  operationId: OperationId,
  version: Schema.Int,
  items: Schema.Array(BoardItem).check(Schema.isMaxLength(maximumBoardItems)),
})
export type SaveBoardItems = typeof SaveBoardItems.Type

/** Pin pieces and looks on a board, newest first; what is pinned already stays where it is. */
export const AddPins = Schema.Struct({
  operationId: OperationId,
  pieceIds: Schema.optionalKey(Schema.Array(PieceId).check(Schema.isMaxLength(pinsAtOnce))),
  lookIds: Schema.optionalKey(Schema.Array(LookId).check(Schema.isMaxLength(pinsAtOnce))),
})
export type AddPins = typeof AddPins.Type

/** Take pins off a board, and off its table; a picture taken off is deleted. */
export const RemovePins = Schema.Struct({
  operationId: OperationId,
  pinIds: Schema.Array(PinId).check(Schema.isMinLength(1), Schema.isMaxLength(pinsAtOnce)),
})
export type RemovePins = typeof RemovePins.Type

/** Something to lay on a board's table without an id of its own: the server gives it one. */
export const TablePiece = Schema.TaggedStruct('TablePiece', { pieceId: PieceId })
export const TablePicture = Schema.TaggedStruct('TablePicture', { imageId: BoardImageId })
export const TableLabel = Schema.TaggedStruct('TableLabel', { text: LabelText, style: TextStyle })
export const TableThing = Schema.Union([TablePiece, TablePicture, TableLabel])
export type TableThing = typeof TableThing.Type

/** How a table is laid out after things are added: left where they land, on an even grid, or in an outfit's
 * places (top, layer, bottom, shoes, an accessory). */
export const TableLayout = Schema.Literals(['keep', 'tidy', 'outfit'])
export type TableLayout = typeof TableLayout.Type

/** Add things to the table and lay it out, from whatever version it is at. */
export const ArrangeBoard = Schema.Struct({
  operationId: OperationId,
  layout: TableLayout,
  add: Schema.optionalKey(Schema.Array(TableThing).check(Schema.isMaxLength(20))),
})
export type ArrangeBoard = typeof ArrangeBoard.Type

/** One thing exactly where it lies; the list's order is the stacking, first at the bottom. */
export const PlacedThing = Schema.Struct({
  thing: TableThing,
  x: placement.x,
  y: placement.y,
  size: placement.size,
  turn: Schema.optionalKey(placement.turn),
  flipped: Schema.optionalKey(Schema.Boolean),
})
export type PlacedThing = typeof PlacedThing.Type

/** The whole table, placed exactly, replacing what was saved, from the version it was read at. */
export const SetTable = Schema.Struct({
  operationId: OperationId,
  version: Schema.Int,
  items: Schema.Array(PlacedThing).check(Schema.isMaxLength(maximumBoardItems)),
})
export type SetTable = typeof SetTable.Type

/** A received photo upload becomes a picture on the board. */
export const AddBoardImage = Schema.Struct({ operationId: OperationId, uploadId: UploadId })
export type AddBoardImage = typeof AddBoardImage.Type

export const BoardImage = Schema.Struct({ imageId: BoardImageId })
export type BoardImage = typeof BoardImage.Type

export class BoardNotFound extends Schema.TaggedError<BoardNotFound>()('BoardNotFound', {}, { httpApiStatus: 404 }) {}

/** Someone saved the board since this editor loaded it (another tab or device). */
export class BoardVersionConflict extends Schema.TaggedError<BoardVersionConflict>()(
  'BoardVersionConflict',
  { version: Schema.Int },
  { httpApiStatus: 409 },
) {}

/** A thing on the table the board cannot hold: a piece that is neither the person's nor pinned on the board, a
 * picture from another board, two things with one id, or more than a table holds. */
export class BoardItemRefused extends Schema.TaggedError<BoardItemRefused>()(
  'BoardItemRefused',
  { reason: Schema.Literals(['pieceNotFound', 'imageNotFound', 'duplicateId', 'tableFull']) },
  { httpApiStatus: 422 },
) {}

/** What cannot be pinned: a piece or look that is not the person's, nothing at all, or more than a board holds. */
export class PinRefused extends Schema.TaggedError<PinRefused>()(
  'PinRefused',
  { reason: Schema.Literals(['pieceNotFound', 'lookNotFound', 'nothingToPin', 'boardFull']) },
  { httpApiStatus: 422 },
) {}
