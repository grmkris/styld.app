import { Schema } from 'effect'
import { BoardItem, Paper } from './Board.ts'
import { Category, PieceId } from './Wardrobe.ts'

/** The words an assistant view shows, written by the server from the catalogs. MCP carries no
 * language, so a result holds both and the view picks the host's. */
export const ViewLabels = Schema.Struct({
  wardrobeTitle: Schema.String,
  empty: Schema.String,
  openInStyld: Schema.String,
  categories: Schema.Struct({
    top: Schema.String,
    bottom: Schema.String,
    dress: Schema.String,
    outerwear: Schema.String,
    shoes: Schema.String,
    accessory: Schema.String,
  }),
})
export type ViewLabels = typeof ViewLabels.Type

/** A piece as a view draws it. Its picture travels apart, as a data URL in the result's `_meta`. */
export const ViewPiece = Schema.Struct({
  id: PieceId,
  name: Schema.NullOr(Schema.String),
  category: Category,
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

/** Everything a tool result can ask an assistant view to show. */
export const AssistantView = Schema.Union([WardrobeView, BoardView])
export type AssistantView = typeof AssistantView.Type

/** Pictures for a view, keyed by piece id (a board's by `piece:` and `picture:` keys), as
 * `data:image/webp;base64,…` URLs. */
export const ViewImages = Schema.Record(Schema.String, Schema.String)
export type ViewImages = typeof ViewImages.Type
