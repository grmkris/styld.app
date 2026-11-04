import {
  type Colour,
  type ImageType,
  type ImportPiece,
  maximumColours,
  maximumImageBytes,
  type PieceType,
  textLength,
} from '@styld/protocol'
import { Schema } from 'effect'

// How a piece of the first Styld (v1) becomes a piece of this one: its category as the nearest garment type (refined by
// the words of its name), its free colour words as the thirteen colours, its name trimmed, and its picture checked.
// Pure: the operator's import (`Import.ts`) maps an export (`Export.ts`) with it, and refused pieces go in the report.
// Clef describes every imported piece again when it is processed; this is only where it starts.

/** One piece as `Export.ts` writes it: v1's `clothing_item` with its category, colour words and main picture. */
export const V1Piece = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Schema.String),
  colours: Schema.Array(Schema.String),
  /** The picture's file, relative to the export's folder. */
  picture: Schema.NonEmptyString,
  /** The type v1 recorded; the bytes' own signature decides. */
  mime: Schema.String,
})
export type V1Piece = typeof V1Piece.Type

/** A wardrobe exported from v1 into a private folder (`Export.ts`). */
export const V1Export = Schema.Struct({
  version: Schema.Literal(1),
  email: Schema.NonEmptyString,
  name: Schema.NullOr(Schema.String),
  exportedAt: Schema.String,
  pieces: Schema.Array(V1Piece),
})
export type V1Export = typeof V1Export.Type

/** Why a piece is not imported. */
export type Refusal = 'notAPicture' | 'placeholder' | 'tooLarge'

/** A v1 piece mapped, or refused with its reason. */
export type Mapped =
  | { readonly _tag: 'Mapped'; readonly piece: ImportPiece }
  | { readonly _tag: 'Refused'; readonly v1Id: string; readonly reason: Refusal }

/** v1's categories, as the nearest type; words of the name pick a closer one in the same place (below). */
const categories: Readonly<Record<string, PieceType>> = {
  top: 'shortSleeveTops',
  tops: 'shortSleeveTops',
  bottom: 'trousers',
  bottoms: 'trousers',
  outerwear: 'jackets',
  dress: 'dresses',
  dresses: 'dresses',
  shoes: 'trainers',
  footwear: 'trainers',
  accessory: 'bags',
  accessories: 'bags',
}

/** Words of a name that say which type it is, in the order they are tried. */
const named: ReadonlyArray<readonly [RegExp, PieceType]> = [
  [/\bjeans?\b|denim trousers/u, 'jeans'],
  [/\bskirts?\b/u, 'skirts'],
  [/\bshorts\b/u, 'shorts'],
  [/\b(jumpsuit|overall|playsuit)s?\b/u, 'jumpsuits'],
  [/\bdress(es)?\b/u, 'dresses'],
  [/\b(coat|trench|parka)s?\b/u, 'coats'],
  [/\bblazers?\b/u, 'blazers'],
  [/\b(gilet|vest)s?\b/u, 'gilets'],
  [/\b(hoodie|sweatshirt)s?\b/u, 'hoodies'],
  [/\b(sweater|jumper|cardigan|knit|pullover)s?\b/u, 'knitwear'],
  [/\b(shirt|blouse)s?\b/u, 'shirts'],
  [/\bbodysuits?\b/u, 'bodysuits'],
  // Tops by sleeve (4 November); a top whose name says neither starts short-sleeved, and Clef's sleeve answer on import
  // moves it.
  [/\blong[- ]?sleeved?\b/u, 'longSleeveTops'],
  [/\b(tank|cami|camisole|halter)s?\b|\bsleeveless\b|\bstrappy\b|\bvest tops?\b/u, 'sleevelessTops'],
  [/\b(boot|bootie)s?\b/u, 'boots'],
  [/\b(heel|pump|stiletto)s?\b/u, 'heels'],
  [/\b(sandal|slide|flip[- ]flop)s?\b/u, 'sandals'],
  [/\b(loafer|ballerina|flat|mule)s?\b/u, 'flats'],
  [/\b(sneaker|trainer)s?\b/u, 'trainers'],
  [/\bbelts?\b/u, 'belts'],
  [/\b(scarf|scarves|shawl)\b/u, 'scarves'],
  [/\b(hat|cap|beanie)s?\b/u, 'hats'],
  [/\b(necklace|ring|earring|bracelet|watch)(es|s)?\b/u, 'jewellery'],
  [/\b(sunglasses|glasses)\b/u, 'eyewear'],
  [/\b(bag|tote|clutch|backpack|purse)s?\b/u, 'bags'],
]

/** The types a category's words may narrow it to: within the same part of an outfit, so a name never moves a coat
 * into the shoes. */
const narrowsTo: Partial<Readonly<Record<PieceType, ReadonlyArray<PieceType>>>> = {
  shortSleeveTops: [
    'shirts',
    'bodysuits',
    'knitwear',
    'hoodies',
    'longSleeveTops',
    'sleevelessTops',
    'dresses',
    'jumpsuits',
  ],
  trousers: ['jeans', 'shorts', 'skirts'],
  jackets: ['coats', 'blazers', 'gilets', 'hoodies', 'knitwear'],
  dresses: ['jumpsuits', 'skirts'],
  trainers: ['boots', 'heels', 'flats', 'sandals'],
  bags: ['belts', 'scarves', 'hats', 'jewellery', 'eyewear'],
}

/** The nearest type to v1's category, narrowed by the name; a piece v1 never categorised starts as a short-sleeved top,
 * which its import's description by Clef corrects. */
export const typeOf = (category: string | null, name: string | null): PieceType => {
  const nearest = categories[(category ?? '').trim().toLowerCase()] ?? 'shortSleeveTops'
  const words = (name ?? '').toLowerCase()
  const allowed = narrowsTo[nearest] ?? []
  const closer = named.find(([pattern, type]) => allowed.includes(type) && pattern.test(words))
  return closer?.[1] ?? nearest
}

/** v1's free colour words onto the thirteen, by the word that names the hue; details (a tab, stitching, hardware) are
 * not the piece's colour. */
const hues: ReadonlyArray<readonly [RegExp, Colour]> = [
  [/navy|dark blue|indigo/u, 'navy'],
  [/blue|denim/u, 'blue'],
  [/black/u, 'black'],
  [/white|ivory/u, 'white'],
  [/cream|beige|khaki|camel|\btan\b/u, 'beige'],
  [/grey|gray|charcoal|gunmetal|silver/u, 'grey'],
  [/brown|cognac|espresso|rust|copper|chocolate/u, 'brown'],
  [/green|olive|khaki green/u, 'green'],
  [/red|crimson|burgundy|wine/u, 'red'],
  [/pink|coral|rose/u, 'pink'],
  [/yellow|gold|mustard/u, 'yellow'],
  [/orange/u, 'orange'],
  [/purple|violet|lilac|lavender/u, 'purple'],
]

export const coloursOf = (words: ReadonlyArray<string>): ReadonlyArray<Colour> =>
  [
    ...new Set(
      words
        .map((word) => word.trim().toLowerCase())
        .filter((word) => !/tab|stitching|hardware|trim/u.test(word))
        .flatMap((word) => {
          const hue = hues.find(([pattern]) => pattern.test(word))
          return hue === undefined ? [] : [hue[1]]
        }),
    ),
  ].slice(0, maximumColours)

/** The name with its spaces folded, cut to a name's length; none when nothing is left. */
export const nameOf = (name: string | null): string | undefined => {
  const trimmed = (name ?? '').replace(/\s+/gu, ' ').trim().slice(0, textLength.name).trim()
  return trimmed.length === 0 ? undefined : trimmed
}

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>, at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte)
const ascii = (text: string) => Array.from(new TextEncoder().encode(text))
const u16be = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
const u16le = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)
const u24le = (bytes: Uint8Array, at: number) => u16le(bytes, at) | ((bytes[at + 2] ?? 0) << 16)
const u32be = (bytes: Uint8Array, at: number) => u16be(bytes, at) * 65536 + u16be(bytes, at + 2)

interface Size {
  readonly width: number
  readonly height: number
}

/** A JPEG's size, from its first frame header. */
const jpegSize = (bytes: Uint8Array): Size | undefined => {
  let at = 2
  while (at + 9 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) return { height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) }
    at += 2 + u16be(bytes, at + 2)
  }
  return undefined
}

/** A WebP's size, from whichever of its three headers it has. */
const webpSize = (bytes: Uint8Array): Size | undefined => {
  if (startsWith(bytes, ascii('VP8 '), 12))
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff }
  if (startsWith(bytes, ascii('VP8L'), 12)) {
    const bits = u16le(bytes, 21) | (u16le(bytes, 23) << 16)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (startsWith(bytes, ascii('VP8X'), 12)) return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 }
  return undefined
}

/** The picture's type by its signature, as v2 checks an upload, and its size where the header says it. */
const pictureOf = (bytes: Uint8Array): { readonly type: ImageType; readonly size: Size | undefined } | undefined => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: 'image/jpeg', size: jpegSize(bytes) }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { type: 'image/png', size: { width: u32be(bytes, 16), height: u32be(bytes, 20) } }
  if (startsWith(bytes, ascii('GIF8')))
    return { type: 'image/gif', size: { width: u16le(bytes, 6), height: u16le(bytes, 8) } }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8))
    return { type: 'image/webp', size: webpSize(bytes) }
  if (
    startsWith(bytes, ascii('ftyp'), 4) &&
    (startsWith(bytes, ascii('avif'), 8) || startsWith(bytes, ascii('avis'), 8))
  )
    return { type: 'image/avif', size: undefined }
  return undefined
}

/** Smaller than this, a picture is a placeholder (v1 stored 1×1 pictures for pieces whose photo never arrived). */
const smallestSide = 64
const fewestBytes = 1024

/** Why a picture cannot be a piece's photo, if it cannot. */
export const pictureRefusal = (bytes: Uint8Array): Refusal | undefined => {
  const picture = pictureOf(bytes)
  if (picture === undefined) return 'notAPicture'
  if (bytes.byteLength > maximumImageBytes) return 'tooLarge'
  const tiny = picture.size !== undefined && Math.min(picture.size.width, picture.size.height) < smallestSide
  return tiny || bytes.byteLength < fewestBytes ? 'placeholder' : undefined
}

/** The file a piece's picture goes to in the import's bundle: its v1 id, made safe for a key. */
export const pictureFile = (v1Id: string) => `pictures/${v1Id.replace(/[^A-Za-z0-9_-]/gu, '_')}`

/** One v1 piece, with its picture's bytes, as a piece to import or a refusal. */
export const mapPiece = (piece: V1Piece, bytes: Uint8Array): Mapped => {
  const refusal = pictureRefusal(bytes)
  const picture = pictureOf(bytes)
  if (refusal !== undefined || picture === undefined)
    return { _tag: 'Refused', v1Id: piece.id, reason: refusal ?? 'notAPicture' }
  const name = nameOf(piece.name)
  return {
    _tag: 'Mapped',
    piece: {
      v1Id: piece.id,
      ...(name === undefined ? {} : { name }),
      type: typeOf(piece.category, piece.name),
      colours: coloursOf(piece.colours),
      picture: pictureFile(piece.id),
      contentType: picture.type,
    },
  }
}
