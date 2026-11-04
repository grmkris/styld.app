import { Schema } from 'effect'

/** Where a house piece's picture came from (owner, 4 November 2026): drawn by Muse from words, or a photo that
 * replaced the drawing. A piece with no provenance is the person's own, from their own photo. Generated pieces exist
 * only on the house accounts and are always shown marked Generated. */
export const PieceOrigin = Schema.Literals(['generated', 'photo'])
export type PieceOrigin = typeof PieceOrigin.Type
