import { Schema } from 'effect'

/** Where a house piece's picture came from (owner, 4 November 2026): drawn by Muse from words, or a photo that
 * replaced the drawing. A piece with no provenance is the person's own, from their own photo. Generated pieces exist
 * only on the house accounts and are always shown marked Generated. */
export const PieceOrigin = Schema.Literals(['generated', 'photo'])
export type PieceOrigin = typeof PieceOrigin.Type

/** The seed manifest's permanent key of a house garment: its import's `seed:<id>`, its picture's file and its
 * provenance row all use it. */
export const ManifestId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,120}$/u))
export type ManifestId = typeof ManifestId.Type

/** A house garment's picture as the seed generated it: which spec, the model, and the digest of the prompt. */
export const GeneratedGarment = Schema.Struct({
  manifestId: ManifestId,
  model: Schema.Literal('muse-image-1.0'),
  promptDigest: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
})
export type GeneratedGarment = typeof GeneratedGarment.Type
