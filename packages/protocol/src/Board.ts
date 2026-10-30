import { Schema } from 'effect'
import { OperationId, PieceId, UploadId } from './Wardrobe.ts'

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

/** A board's table is a sheet 1000 units across and 1250 down (4:5); placements are in those units. */
export const boardWidth = 1000
export const boardHeight = 1250
/** The most things one board holds. */
export const maximumBoardItems = 60
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

export const Board = Schema.Struct({
  id: BoardId,
  name: Schema.String,
  paper: Paper,
  /** Bumped by every save; a save names the version it started from. */
  version: Schema.Int,
  items: Schema.Array(BoardItem),
  updatedAt: Schema.String,
})
export type Board = typeof Board.Type

export const Boards = Schema.Struct({ boards: Schema.Array(Board) })

export const CreateBoard = Schema.Struct({ operationId: OperationId, name: BoardName })
export type CreateBoard = typeof CreateBoard.Type

export const UpdateBoard = Schema.Struct({ name: Schema.optionalKey(BoardName), paper: Schema.optionalKey(Paper) })
export type UpdateBoard = typeof UpdateBoard.Type

/** The whole table, replacing what was saved, from the version the editor started with. */
export const SaveBoardItems = Schema.Struct({
  version: Schema.Int,
  items: Schema.Array(BoardItem).check(Schema.isMaxLength(maximumBoardItems)),
})
export type SaveBoardItems = typeof SaveBoardItems.Type

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

/** A thing on the table the board cannot hold: a piece that is not the person's, a picture from another
 * board, or two things with one id. */
export class BoardItemRefused extends Schema.TaggedError<BoardItemRefused>()(
  'BoardItemRefused',
  { reason: Schema.Literals(['pieceNotFound', 'imageNotFound', 'duplicateId']) },
  { httpApiStatus: 422 },
) {}
