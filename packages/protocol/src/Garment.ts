import { maximumOccasions } from './Limits.ts'
import { textLength, trimmedText, Url } from './Text.ts'
import { Schema } from 'effect'

// What a piece is (owner, 2026-10-31): Styld's own garment types, predefined and grouped the way shops sort them, so
// the wardrobe browses like a shop. A piece stores its type alone; its group and its place in an outfit follow from
// the type, so they can never disagree with it.

/** The groups, in the order the wardrobe shows them. Sport holds what is worn for sport, as a shop's Sport section
 * does (owner, 2026-11-03, T-07); swimwear and loungewear stay with the clothes. */
export const GarmentGroup = Schema.Literals(['clothing', 'sport', 'shoes', 'accessories'])
export type GarmentGroup = typeof GarmentGroup.Type

/** Every garment type, keyed in English, in the order the wardrobe shows them. */
export const PieceType = Schema.Literals([
  'shortSleeveTops',
  'longSleeveTops',
  'sleevelessTops',
  'shirts',
  'bodysuits',
  'knitwear',
  'hoodies',
  'blazers',
  'jackets',
  'coats',
  'gilets',
  'dresses',
  'jumpsuits',
  'jeans',
  'trousers',
  'shorts',
  'skirts',
  'sportsBras',
  'sportTops',
  'sportBottoms',
  'tracksuits',
  'sportShoes',
  'outdoorShoes',
  'swimwear',
  'loungewear',
  'trainers',
  'boots',
  'heels',
  'flats',
  'loafers',
  'laceUps',
  'sandals',
  'bags',
  'belts',
  'scarves',
  'hats',
  'gloves',
  'socks',
  'hairAccessories',
  'jewellery',
  'eyewear',
])
export type PieceType = typeof PieceType.Type

/** Where a piece sits in an outfit. `set` holds what is worn on its own for one activity (a tracksuit, swimwear,
 * loungewear); outfits use it only when that activity is asked for. Never shown to people. */
export const Slot = Schema.Literals(['top', 'bottom', 'onePiece', 'layer', 'shoes', 'accessory', 'set'])
export type Slot = typeof Slot.Type

const kinds: { readonly [Type in PieceType]: { readonly group: GarmentGroup; readonly slot: Slot } } = {
  // Tops by sleeve (Eva's review, 4 November: "I'd split tops and T-shirts into short, long and sleeveless").
  shortSleeveTops: { group: 'clothing', slot: 'top' },
  longSleeveTops: { group: 'clothing', slot: 'top' },
  sleevelessTops: { group: 'clothing', slot: 'top' },
  shirts: { group: 'clothing', slot: 'top' },
  bodysuits: { group: 'clothing', slot: 'top' },
  knitwear: { group: 'clothing', slot: 'top' },
  hoodies: { group: 'clothing', slot: 'top' },
  blazers: { group: 'clothing', slot: 'layer' },
  jackets: { group: 'clothing', slot: 'layer' },
  coats: { group: 'clothing', slot: 'layer' },
  gilets: { group: 'clothing', slot: 'layer' },
  dresses: { group: 'clothing', slot: 'onePiece' },
  jumpsuits: { group: 'clothing', slot: 'onePiece' },
  jeans: { group: 'clothing', slot: 'bottom' },
  trousers: { group: 'clothing', slot: 'bottom' },
  shorts: { group: 'clothing', slot: 'bottom' },
  skirts: { group: 'clothing', slot: 'bottom' },
  // Sport by shape (owner, 4 November: Eva found leggings and sports bras sorted among everyday clothes): worn only
  // when an outfit is for sport (outfits/Rules.ts › suits), as separates or as a tracksuit set.
  sportsBras: { group: 'sport', slot: 'top' },
  sportTops: { group: 'sport', slot: 'top' },
  sportBottoms: { group: 'sport', slot: 'bottom' },
  tracksuits: { group: 'sport', slot: 'set' },
  // Shoes made for sport: worn only when an outfit is for sport (outfits/Rules.ts › suits).
  sportShoes: { group: 'sport', slot: 'shoes' },
  outdoorShoes: { group: 'sport', slot: 'shoes' },
  swimwear: { group: 'clothing', slot: 'set' },
  loungewear: { group: 'clothing', slot: 'set' },
  trainers: { group: 'shoes', slot: 'shoes' },
  boots: { group: 'shoes', slot: 'shoes' },
  heels: { group: 'shoes', slot: 'shoes' },
  flats: { group: 'shoes', slot: 'shoes' },
  loafers: { group: 'shoes', slot: 'shoes' },
  laceUps: { group: 'shoes', slot: 'shoes' },
  sandals: { group: 'shoes', slot: 'shoes' },
  bags: { group: 'accessories', slot: 'accessory' },
  belts: { group: 'accessories', slot: 'accessory' },
  scarves: { group: 'accessories', slot: 'accessory' },
  hats: { group: 'accessories', slot: 'accessory' },
  gloves: { group: 'accessories', slot: 'accessory' },
  socks: { group: 'accessories', slot: 'accessory' },
  hairAccessories: { group: 'accessories', slot: 'accessory' },
  jewellery: { group: 'accessories', slot: 'accessory' },
  eyewear: { group: 'accessories', slot: 'accessory' },
}

export const groupOf = (type: PieceType): GarmentGroup => kinds[type].group
export const slotOf = (type: PieceType): Slot => kinds[type].slot

/** The types of a group, in the wardrobe's order. */
export const typesIn = (group: GarmentGroup): ReadonlyArray<PieceType> =>
  PieceType.literals.filter((type) => groupOf(type) === group)

/** The types that sit in the same place in an outfit: what "Already in your wardrobe?" compares a garment with, so one
 * misjudged type never hides a duplicate. */
export const typesInSlot = (slot: Slot): ReadonlyArray<PieceType> =>
  PieceType.literals.filter((type) => slotOf(type) === slot)

/** When a piece is worn (owner, 2026-11-03, T-12): any of the four seasons; a piece with none is worn all year. */
export const Season = Schema.Literals(['spring', 'summer', 'autumn', 'winter'])
export type Season = typeof Season.Type
export const Seasons = Schema.Array(Season).check(Schema.isUnique())
export type Seasons = typeof Seasons.Type

/** What a piece is worn for; a piece can suit several. */
export const Occasion = Schema.Literals(['casual', 'smart', 'formal', 'sport', 'lounge'])
export type Occasion = typeof Occasion.Type

export const Occasions = Schema.Array(Occasion).check(Schema.isUnique(), Schema.isMaxLength(maximumOccasions))

export const Pattern = Schema.Literals(['plain', 'striped', 'checked', 'printed'])
export type Pattern = typeof Pattern.Type

/** A brand as the person writes it. */
export const Brand = trimmedText(textLength.brand)

/** Where the piece is sold: an https address. */
export const ShopUrl = Url.check(Schema.isPattern(/^https:\/\/\S+$/))
