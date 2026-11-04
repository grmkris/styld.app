import { Schema } from 'effect'
import { BoardItem, Paper } from './Board.ts'
import { GarmentGroup } from './Garment.ts'
import { PieceId } from './Wardrobe.ts'

/** The words an assistant view shows, written by the server from the catalogs. MCP carries no
 * language, so a result holds both and the view picks the host's. */
export const ViewLabels = Schema.Struct({
  wardrobeTitle: Schema.String,
  empty: Schema.String,
  openInStyld: Schema.String,
  /** Each group's name, for a piece the person did not name. */
  groups: Schema.Record(GarmentGroup, Schema.String),
})
export type ViewLabels = typeof ViewLabels.Type

/** A piece as a view draws it. Its picture travels apart, as a data URL in the result's `_meta`. */
export const ViewPiece = Schema.Struct({
  id: PieceId,
  name: Schema.NullOr(Schema.String),
  group: GarmentGroup,
  url: Schema.String,
})
export type ViewPiece = typeof ViewPiece.Type

/** The wardrobe, as `wardrobe_show` returns it to the assistant and to its view. */
export const WardrobeView = Schema.TaggedStruct('WardrobeView', {
  pieces: Schema.Array(ViewPiece),
  url: Schema.String,
  labels: Schema.Struct({ en: ViewLabels, sl: ViewLabels }),
})
export type WardrobeView = typeof WardrobeView.Type

/** The words a board's view shows. */
export const BoardViewLabels = Schema.Struct({
  pinned: Schema.String,
  empty: Schema.String,
  picture: Schema.String,
  openInStyld: Schema.String,
})
export type BoardViewLabels = typeof BoardViewLabels.Type

/** A pin as a board's view draws it: its picture's key in the result's images, and where it opens. */
export const ViewPin = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  image: Schema.String,
  url: Schema.NullOr(Schema.String),
})
export type ViewPin = typeof ViewPin.Type

/** A board, as `board_show` returns it: its collage as a still table, then its pins. Pictures are keyed
 * `piece:<id>` and `picture:<id>`. */
export const BoardView = Schema.TaggedStruct('BoardView', {
  name: Schema.String,
  paper: Paper,
  items: Schema.Array(BoardItem),
  pins: Schema.Array(ViewPin),
  url: Schema.String,
  labels: Schema.Struct({ en: BoardViewLabels, sl: BoardViewLabels }),
})
export type BoardView = typeof BoardView.Type

/** The garment groups' names, for a piece the person did not name. */
const GroupLabels = ViewLabels.fields.groups

/** The words a try-on's view shows. */
export const TryOnViewLabels = Schema.Struct({
  title: Schema.String,
  before: Schema.String,
  after: Schema.String,
  drawing: Schema.String,
  stopped: Schema.String,
  wearing: Schema.String,
  openInStyld: Schema.String,
  groups: GroupLabels,
})
export type TryOnViewLabels = typeof TryOnViewLabels.Type

/** A try-on, as `tryon_show` returns it: the person's photo and what Styld drew from it, keyed `photo:<id>` and
 * `tryOn:<id>` in the result's images, and the pieces it wears, keyed by piece id. Ids are plain strings, so the view
 * never loads the HTTP contract. */
export const TryOnView = Schema.TaggedStruct('TryOnView', {
  id: Schema.String,
  status: Schema.Literals(['drawing', 'done', 'stopped']),
  before: Schema.String,
  after: Schema.String,
  pieces: Schema.Array(ViewPiece),
  url: Schema.String,
  labels: Schema.Struct({ en: TryOnViewLabels, sl: TryOnViewLabels }),
})
export type TryOnView = typeof TryOnView.Type

/** The words the Gallery's view shows. */
export const GalleryViewLabels = Schema.Struct({
  title: Schema.String,
  empty: Schema.String,
  openInStyld: Schema.String,
})
export type GalleryViewLabels = typeof GalleryViewLabels.Type

/** One of the person's Gallery photos as the view draws it: its number for the person to say, the day it was added
 * (`YYYY-MM-DD`), what Styld found in it, and its page. Its picture is keyed `photo:<id>`. */
export const GalleryPhoto = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  day: Schema.String,
  found: Schema.Array(Schema.String),
  url: Schema.String,
})
export type GalleryPhoto = typeof GalleryPhoto.Type

/** My Gallery, as `gallery_show` returns it: the newest photos, numbered. */
export const GalleryView = Schema.TaggedStruct('GalleryView', {
  photos: Schema.Array(GalleryPhoto),
  url: Schema.String,
  labels: Schema.Struct({ en: GalleryViewLabels, sl: GalleryViewLabels }),
})
export type GalleryView = typeof GalleryView.Type

/** The words a view of pieces shows. */
export const PiecesViewLabels = Schema.Struct({
  title: Schema.String,
  outfit: Schema.String,
  empty: Schema.String,
  openInStyld: Schema.String,
  groups: GroupLabels,
})
export type PiecesViewLabels = typeof PiecesViewLabels.Type

/** Some of the person's pieces, as `pieces_show` returns them (one row) or `outfits_show` (one row per outfit), under
 * the assistant's title when it gave one. Pictures are keyed by piece id. */
export const PiecesView = Schema.TaggedStruct('PiecesView', {
  title: Schema.NullOr(Schema.String),
  outfits: Schema.Boolean,
  rows: Schema.Array(Schema.Array(ViewPiece)),
  url: Schema.String,
  labels: Schema.Struct({ en: PiecesViewLabels, sl: PiecesViewLabels }),
})
export type PiecesView = typeof PiecesView.Type

/** Which of a piece's pictures a picture is: the one it shows, its drawing, its back, its back drawn, the person's own
 * photo, or the cut-out. */
export const PiecePictureKind = Schema.Literals(['shown', 'clean', 'back', 'backClean', 'photo', 'cutout'])
export type PiecePictureKind = typeof PiecePictureKind.Type

/** The words a piece's view shows: each picture's name, and the groups'. */
export const PieceViewLabels = Schema.Struct({
  pictures: Schema.Record(PiecePictureKind, Schema.String),
  openInStyld: Schema.String,
  groups: GroupLabels,
})
export type PieceViewLabels = typeof PieceViewLabels.Type

/** One piece with its pictures, as `piece_show` returns it: each keyed `piece:<id>:<kind>` in the result's images,
 * and the words that describe it. */
export const PieceView = Schema.TaggedStruct('PieceView', {
  piece: ViewPiece,
  details: Schema.Array(Schema.String),
  pictures: Schema.Array(Schema.Struct({ kind: PiecePictureKind, image: Schema.String })),
  labels: Schema.Struct({ en: PieceViewLabels, sl: PieceViewLabels }),
})
export type PieceView = typeof PieceView.Type

/** Everything a tool result can ask an assistant view to show. */
export const AssistantView = Schema.Union([WardrobeView, BoardView, TryOnView, GalleryView, PiecesView, PieceView])
export type AssistantView = typeof AssistantView.Type

/** Pictures for a view, keyed by piece id (a board's by `piece:` and `picture:` keys), as
 * `data:image/webp;base64,…` URLs. */
export const ViewImages = Schema.Record(Schema.String, Schema.String)
export type ViewImages = typeof ViewImages.Type
