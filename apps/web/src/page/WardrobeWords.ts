import type { Category, Colour, Subcategory } from '@styld/protocol'
import type { MessageKey } from '@styld/i18n'

// The catalog names of the wardrobe's categories, shelves and colours (v1's reviewed copy). Each key is
// built from the value, and `satisfies` makes the type checker refuse a value the catalogs do not name.
export const categoryName = (category: Category) => `wardrobe.mainCategories.${category}` as const satisfies MessageKey
export const subcategoryName = (subcategory: Subcategory) =>
  `wardrobe.shelves.labels.${subcategory}` as const satisfies MessageKey
export const colourName = (colour: Colour) => `wardrobe.addPieceColor_${colour}` as const satisfies MessageKey
