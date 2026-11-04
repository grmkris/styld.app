import { maximumBoardItems, maximumLookPieces, maximumMoods, mostSeen, pinsAtOnce } from './Limits.ts'
import { Name, textLength, trimmedText } from './Text.ts'
import { entityId, OperationId } from './Ids.ts'
import { Schema } from 'effect'
import { byCase, passing, refusal } from './Errors.ts'
import { CheckStatus, Visibility } from './Check.ts'
import { Mood } from './Mood.ts'
import { Look, LookId } from './Look.ts'
import { OutfitKey, OutfitMode, OutfitSession, ProposalRef } from './Outfit.ts'
import { Season, Slot } from './Garment.ts'
import { Piece, PieceId, UploadId } from './Wardrobe.ts'

/** Opaque ids: a kind prefix and 22 base64url characters (16 random bytes). The website makes item ids
 * itself, because items appear while the person edits and are saved together. */
export const BoardId = entityId('bd').pipe(Schema.brand('BoardId'))
export type BoardId = typeof BoardId.Type
export const BoardItemId = entityId('bi').pipe(Schema.brand('BoardItemId'))
export type BoardItemId = typeof BoardItemId.Type
export const BoardImageId = entityId('bm').pipe(Schema.brand('BoardImageId'))
export type BoardImageId = typeof BoardImageId.Type
export const PinId = entityId('pn').pipe(Schema.brand('PinId'))
export type PinId = typeof PinId.Type
export const BoardOutfitId = entityId('bo').pipe(Schema.brand('BoardOutfitId'))
export type BoardOutfitId = typeof BoardOutfitId.Type

/** A board's table is a sheet 1000 units across and 1250 down (4:5); placements are in those units. */
export const boardWidth = 1000
export const boardHeight = 1250
export const minimumItemSize = 40
export const maximumItemSize = 1200

/** The sheet's colour. */
export const Paper = Schema.Literals(['paper', 'stock', 'sand', 'sage', 'slate', 'clay'])
export type Paper = typeof Paper.Type

/** What a board was started from (T-10): one piece and outfits around it. A blank board has none. */
export const BoardTemplate = Schema.Literals(['outfitsAround'])
export type BoardTemplate = typeof BoardTemplate.Type

/** A text label's face: a plain label, or the headline in the logo's condensed voice. */
export const TextStyle = Schema.Literals(['label', 'headline'])
export type TextStyle = typeof TextStyle.Type

export const BoardName = trimmedText(textLength.boardName)
export const LabelText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(textLength.label))

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
export const BoardImageAddresses = Schema.Struct({ thumb: Schema.String, full: Schema.String })
export const ImageItem = Schema.TaggedStruct('ImageItem', {
  ...placement,
  imageId: BoardImageId,
  image: Schema.optionalKey(BoardImageAddresses),
})
export type ImageItem = typeof ImageItem.Type

export const BoardItem = Schema.Union([PieceItem, TextItem, ImageItem])
export type BoardItem = typeof BoardItem.Type

/** One of the person's pieces pinned on the board. */
export const PiecePin = Schema.TaggedStruct('PiecePin', { id: PinId, piece: Piece, addedAt: Schema.String })
export type PiecePin = typeof PiecePin.Type
/** A picture on the board: pasted, dropped or chosen, or made by Styld. */
export const PicturePin = Schema.TaggedStruct('PicturePin', {
  id: PinId,
  imageId: BoardImageId,
  image: Schema.optionalKey(BoardImageAddresses),
  /** Styld made it: shown marked Generated. */
  generated: Schema.Boolean,
  addedAt: Schema.String,
})
export type PicturePin = typeof PicturePin.Type
/** One of the person's looks pinned on the board. */
export const LookPin = Schema.TaggedStruct('LookPin', { id: PinId, look: Look, addedAt: Schema.String })
export type LookPin = typeof LookPin.Type

export const Pin = Schema.Union([PiecePin, PicturePin, LookPin])
export type Pin = typeof Pin.Type

/** One outfit of a "One piece, six outfits" board (T-10): its pieces still in the wardrobe, in wearing order; the look
 * it became once kept; and the run and way that made it, which a keep names so it is counted. */
export const BoardOutfit = Schema.Struct({
  id: BoardOutfitId,
  pieces: Schema.Array(Piece),
  lookId: Schema.NullOr(LookId),
  session: OutfitSession,
  mode: OutfitMode,
})
export type BoardOutfit = typeof BoardOutfit.Type

/** What a board started from "One piece, six outfits" holds besides its table: the piece it was built around (none
 * once that piece is deleted) and its outfits, in their places. */
export const OutfitsAround = Schema.Struct({ anchor: Schema.NullOr(Piece), outfits: Schema.Array(BoardOutfit) })
export type OutfitsAround = typeof OutfitsAround.Type

/** A board: its pins, newest first, and its table, which places some of them. */
export const Board = Schema.Struct({
  id: BoardId,
  name: Schema.String,
  paper: Paper,
  /** Bumped by every save of the table; a save names the version it started from. Placing pins also advances it. */
  version: Schema.Int,
  items: Schema.Array(BoardItem),
  pins: Schema.Array(Pin),
  /** The pins others see while the board is public, by the public page's rule: a piece needs a picture of its own and a
   * check that lets others see it, a look its own check, and an outfit photo never shows. None while it is private. */
  publicPins: Schema.Array(PinId),
  /** Up to three moods, for Explore. */
  moods: Schema.Array(Mood),
  visibility: Visibility,
  /** The model's check, once the board has been public; others see it only while the check lets them. */
  check: Schema.NullOr(CheckStatus),
  updatedAt: Schema.String,
  /** Only on a board started from "One piece, six outfits". */
  outfitsAround: Schema.optionalKey(OutfitsAround),
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
  operationId: OperationId,
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
  /** Also place missing pieces on the canvas, preserving the existing layout. */
  placeOnTable: Schema.optionalKey(Schema.Boolean),
})
export type AddPins = typeof AddPins.Type

/** Take pins off a board, and off its table; a picture taken off is deleted. */
export const RemovePins = Schema.Struct({
  operationId: OperationId,
  pinIds: Schema.Array(PinId).check(Schema.isMinLength(1), Schema.isMaxLength(pinsAtOnce)),
})
export type RemovePins = typeof RemovePins.Type

/** Keep some of a board's pieces as a look, pinned on the board (T-16): what the person selected on its table, or
 * all of it. With the proposal it came from, the keep is counted for the outfit engine. */
export const KeepLook = Schema.Struct({
  operationId: OperationId,
  name: Name,
  pieceIds: Schema.Array(PieceId).check(Schema.isMinLength(1), Schema.isMaxLength(maximumLookPieces)),
  proposal: Schema.optionalKey(ProposalRef),
  /** The outfit of a "One piece, six outfits" board kept, which then shows it as kept. */
  outfitId: Schema.optionalKey(BoardOutfitId),
})
export type KeepLook = typeof KeepLook.Type

/** The look kept, and the board it is now pinned on. */
export const KeptLook = Schema.Struct({ look: Look, board: Board })
export type KeptLook = typeof KeptLook.Type

/** Start a "One piece, six outfits" board (T-10): complete outfits around one of the person's pieces, for a season if
 * one is given, laid out on its table. Free, at the account's outfit pace. */
export const CreateOutfitBoard = Schema.Struct({
  operationId: OperationId,
  name: BoardName,
  anchorPieceId: PieceId,
  season: Schema.optionalKey(Season),
})
export type CreateOutfitBoard = typeof CreateOutfitBoard.Type

/** Another outfit in place of one not kept, none of the combinations already shown. */
export const AnotherOutfit = Schema.Struct({
  operationId: OperationId,
  seen: Schema.Array(OutfitKey).check(Schema.isMaxLength(mostSeen)),
})
export type AnotherOutfit = typeof AnotherOutfit.Type

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

export const BoardImage = Schema.Struct({ imageId: BoardImageId, image: Schema.optionalKey(BoardImageAddresses) })
export type BoardImage = typeof BoardImage.Type

/** Someone saved the board since this editor loaded it (another tab or device). */
export class BoardVersionConflict extends Schema.TaggedError<BoardVersionConflict>()(
  'BoardVersionConflict',
  { version: Schema.Int },
  {
    httpApiStatus: 409,
    guide: passing(
      'version_conflict',
      'The table was saved elsewhere meanwhile; it is at version {version} now.',
      'Call board_get, then set the table again from its version.',
    ),
  },
) {}

const ItemRefusal = Schema.Literals(['pieceNotFound', 'imageNotFound', 'duplicateId', 'tableFull'])

/** A thing on the table the board cannot hold: a piece that is neither the person's nor pinned on the board, a
 * picture from another board, two things with one id, or more than a table holds. */
export class BoardItemRefused extends Schema.TaggedError<BoardItemRefused>()(
  'BoardItemRefused',
  { reason: ItemRefusal },
  {
    httpApiStatus: 422,
    guide: byCase<typeof ItemRefusal.Type>('reason', {
      pieceNotFound: refusal(
        'piece_not_found',
        'A piece on that table is neither in this wardrobe nor pinned on the board.',
        'Use piece ids from piece_search, or pin the piece first with pin_add.',
      ),
      imageNotFound: refusal(
        'picture_not_found',
        'A picture on that table is not on this board.',
        'Use imageId values from board_get, or add the picture with picture_pin.',
      ),
      duplicateId: refusal('duplicate', 'The table holds one thing twice.', 'Give each thing once.'),
      tableFull: refusal(
        'table_full',
        `A table holds at most ${maximumBoardItems} things.`,
        'Take some off with collage_set first.',
      ),
    }),
  },
) {}

const PinRefusal = Schema.Literals(['pieceNotFound', 'lookNotFound', 'nothingToPin', 'boardFull'])

/** What cannot be pinned: a piece or look that is not the person's, nothing at all, or more than a board holds. */
export class PinRefused extends Schema.TaggedError<PinRefused>()(
  'PinRefused',
  { reason: PinRefusal },
  {
    httpApiStatus: 422,
    guide: byCase<typeof PinRefusal.Type>('reason', {
      pieceNotFound: refusal('piece_not_found', 'One of those pieces is not in this wardrobe.', 'Call piece_search.'),
      lookNotFound: refusal('look_not_found', 'One of those looks is not this account’s.', 'Call look_list.'),
      nothingToPin: refusal('nothing_to_pin', 'There was nothing to pin.', 'Give pieceIds or lookIds.'),
      boardFull: refusal('board_full', 'That would put more on the board than it holds.', 'Unpin something first.'),
    }),
  },
) {}

const OutfitRefusal = Schema.Literals(['noOutfits', 'kept', 'anchorGone'])

/** Why a template board's outfits could not be made: the wardrobe has no complete outfit around the piece (and what it
 * lacks), the outfit was kept as a look, or the piece it was built around is gone. */
export class OutfitRefused extends Schema.TaggedError<OutfitRefused>()(
  'OutfitRefused',
  { reason: OutfitRefusal, missing: Schema.Array(Slot) },
  {
    httpApiStatus: 422,
    guide: byCase<typeof OutfitRefusal.Type>('reason', {
      noOutfits: refusal(
        'no_outfits',
        'This wardrobe has no complete outfit around that piece.',
        'Add the pieces it lacks (missing), or choose another piece.',
      ),
      kept: refusal('outfit_kept', 'That outfit is kept as a look.', 'Ask for another outfit in another place.'),
      anchorGone: refusal('anchor_gone', 'The piece this board was built around was deleted.', 'Start a new board.'),
    }),
  },
) {}
