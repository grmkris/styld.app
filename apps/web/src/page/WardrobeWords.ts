import { format, type Locale, type MessageKey } from '@styld/i18n'
import type { Colour, GarmentGroup, Occasion, Pattern, Piece, PieceType, Season } from '@styld/protocol'

// The catalog names of the wardrobe's garment types, groups, colours and attributes. Each key is built from the value,
// and `satisfies` makes the type checker refuse a value the catalogs do not name.
export const typeName = (type: PieceType) => `wardrobe.types.${type}` as const satisfies MessageKey
export const groupName = (group: GarmentGroup) => `wardrobe.groups.${group}` as const satisfies MessageKey
export const colourName = (colour: Colour) => `wardrobe.addPieceColor_${colour}` as const satisfies MessageKey
export const seasonName = (season: Season) => `wardrobe.season.${season}` as const satisfies MessageKey
export const occasionName = (occasion: Occasion) => `wardrobe.occasion.${occasion}` as const satisfies MessageKey
export const patternName = (pattern: Pattern) => `wardrobe.pattern.${pattern}` as const satisfies MessageKey
/** The words people use for a type, beyond its name ("tee" for tops), which Ask's search also matches. */
export const typeWordsName = (type: PieceType) => `wardrobe.typeWords.${type}` as const satisfies MessageKey

/** What one piece is, in the singular ("Skirt", "Top"). */
export const kindName = (piece: Pick<Piece, 'type'>) => `wardrobe.typeOne.${piece.type}` as const satisfies MessageKey

/** A piece's name, or what it is when it has none: the same caption on every page, never a type's plural. */
export const pieceLabel = (piece: Pick<Piece, 'name' | 'type'>, locale: Locale) =>
  piece.name ?? format(locale, kindName(piece), {})
