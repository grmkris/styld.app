import { Schema } from 'effect'
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

/** Everything a tool result can ask an assistant view to show. */
export const AssistantView = Schema.Union([WardrobeView])
export type AssistantView = typeof AssistantView.Type

/** Pictures for a view, keyed by piece id, as `data:image/webp;base64,…` URLs. */
export const ViewImages = Schema.Record(Schema.String, Schema.String)
export type ViewImages = typeof ViewImages.Type
