import { Schema } from 'effect'
import { Occasion, Season } from './Garment.ts'

// What a board is about (the house boards, owner 4 November 2026): who it is for, when it is worn, what it was built
// as, what for and in which style. Only the operator's seeding writes tags for now; there is no screen for them.

/** Who a board is for: what "Show me" ranks first. A board for everyone ranks with the boards nobody tagged. */
export const Audience = Schema.Literals(['women', 'men', 'all'])
export type Audience = typeof Audience.Type

/** The kinds of tag a board can carry. */
export const TagKind = Schema.Literals(['audience', 'season', 'template', 'occasion', 'aesthetic'])
export type TagKind = typeof TagKind.Type

/** How a house board was built from its pieces: one piece in many outfits, one outfit, several outfits, a packing
 * list, a challenge, or a collage of pieces. */
export const BoardBuild = Schema.Literals(['onePiece', 'look', 'outfits', 'pack', 'challenge', 'pieceCollage'])
export type BoardBuild = typeof BoardBuild.Type

/** A style word for a board, as a slug: `city-break`, `poetcore`. */
export const Aesthetic = Schema.String.check(Schema.isMaxLength(40), Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))
export type Aesthetic = typeof Aesthetic.Type

/** One tag, its value checked by its kind. */
export const BoardTag = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('audience'), value: Audience }),
  Schema.Struct({ kind: Schema.Literal('season'), value: Season }),
  Schema.Struct({ kind: Schema.Literal('template'), value: BoardBuild }),
  Schema.Struct({ kind: Schema.Literal('occasion'), value: Occasion }),
  Schema.Struct({ kind: Schema.Literal('aesthetic'), value: Aesthetic }),
])
export type BoardTag = typeof BoardTag.Type
