import { format, type Locale, type MessageKey } from '@styld/i18n'
import type { Category, Colour, Piece, Subcategory } from '@styld/protocol'

// The catalog names of the wardrobe's categories, shelves and colours (v1's reviewed copy). Each key is
// built from the value, and `satisfies` makes the type checker refuse a value the catalogs do not name.
export const categoryName = (category: Category) => `wardrobe.mainCategories.${category}` as const satisfies MessageKey
export const subcategoryName = (subcategory: Subcategory) =>
  `wardrobe.shelves.labels.${subcategory}` as const satisfies MessageKey
export const colourName = (colour: Colour) => `wardrobe.addPieceColor_${colour}` as const satisfies MessageKey
/** The words people use for a category, beyond its name ("čevlji" for shoes), which Ask's search also matches. */
export const searchWordsName = (category: Category) => `ask.searchWords.${category}` as const satisfies MessageKey

/** Shelves that name a kind of piece; `sport` and `other` sit in several categories, so the category names those. */
type KindShelf = Exclude<Subcategory, 'sport' | 'other'>
const isKindShelf = (subcategory: Subcategory | null): subcategory is KindShelf =>
  subcategory !== null && subcategory !== 'sport' && subcategory !== 'other'

/** What one piece is, in the singular ("Skirt", "Top"), from its shelf or else its category. */
export const kindName = (piece: Pick<Piece, 'category' | 'subcategory'>) =>
  isKindShelf(piece.subcategory)
    ? (`wardrobe.kindOne.${piece.subcategory}` as const satisfies MessageKey)
    : (`wardrobe.kindOne.${piece.category}` as const satisfies MessageKey)

/** A piece's name, or what it is when it has none: the same caption on every page, never a category's plural. */
export const pieceLabel = (piece: Pick<Piece, 'name' | 'category' | 'subcategory'>, locale: Locale) =>
  piece.name ?? format(locale, kindName(piece), {})
