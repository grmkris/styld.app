import { format, type Locale, type MessageKey } from '@styld/i18n'
import type { Colour, GarmentGroup, Occasion, Pattern, Piece, PieceType, Season } from '@styld/protocol'
import { intlLocale } from '../Locale.ts'

// The catalog names of the wardrobe's garment types, groups, colours and attributes. Each key is built from the value,
// and `satisfies` makes the type checker refuse a value the catalogs do not name.
export const typeName = (type: PieceType) => `wardrobe.types.${type}` as const satisfies MessageKey
export const groupName = (group: GarmentGroup) => `wardrobe.groups.${group}` as const satisfies MessageKey
export const colourName = (colour: Colour) => `wardrobe.addPieceColor_${colour}` as const satisfies MessageKey
export const seasonName = (season: Season) => `wardrobe.season.${season}` as const satisfies MessageKey
export const occasionName = (occasion: Occasion) => `wardrobe.occasion.${occasion}` as const satisfies MessageKey
export const patternName = (pattern: Pattern) => `wardrobe.pattern.${pattern}` as const satisfies MessageKey

/** What one piece is, in the singular ("Skirt", "T-shirt"). */
export const kindName = (piece: Pick<Piece, 'type'>) => `wardrobe.typeOne.${piece.type}` as const satisfies MessageKey

/** A piece's name, or what it is when it has none: the same caption on every page, never a type's plural. */
export const pieceLabel = (piece: Pick<Piece, 'name' | 'type'>, locale: Locale) =>
  piece.name ?? format(locale, kindName(piece), {})

/** A piece told apart from the others where many are listed by name alone (a picker, the collage's tray): its name,
 * or what it is and its colours ("Shirt, white and blue"). */
export const pieceDescription = (piece: Pick<Piece, 'name' | 'type' | 'colours'>, locale: Locale) => {
  if (piece.name !== null) return piece.name
  const kind = format(locale, kindName(piece), {})
  if (piece.colours.length === 0) return kind
  const colours = new Intl.ListFormat(intlLocale(locale), { type: 'conjunction' }).format(
    piece.colours.map((colour) => format(locale, colourName(colour), {}).toLocaleLowerCase(intlLocale(locale))),
  )
  return format(locale, 'wardrobe.pieceDescribed', { kind, colours })
}
