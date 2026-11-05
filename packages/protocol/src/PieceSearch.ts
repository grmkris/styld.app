import { format, type Locale, type MessageKey } from '@styld/i18n'
import { Array, Schema, Struct } from 'effect'
import { GarmentGroup, groupOf, Occasion, Pattern, PieceType, Season } from './Garment.ts'
import { textLength } from './Text.ts'
import { normalise, wordMatches, wordsIn } from './Search.ts'
import { Colour, Piece } from './Wardrobe.ts'

// The one search of a person's own pieces: the website's Ask and pickers, the assistants' `piece_search` and
// `wardrobe_show`, and Styld's chat all find the same pieces for the same words. Only ready pieces are found, and every
// word typed must match a word the piece answers to: its name, notes and brand, and, in each language asked, its type
// with the words people use for it, its group and its colours (the catalogs' own names). Text folds as `Search.ts`.

/** What the person's pieces are filtered by: words, and any of the piece's type, group and attributes. */
export const PieceFilter = Schema.Struct({
  q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(textLength.search))),
  type: Schema.optionalKey(PieceType),
  group: Schema.optionalKey(GarmentGroup),
  colour: Schema.optionalKey(Colour),
  season: Schema.optionalKey(Season),
  occasion: Schema.optionalKey(Occasion),
  pattern: Schema.optionalKey(Pattern),
  brand: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(textLength.brand))),
})
export type PieceFilter = typeof PieceFilter.Type

/** What a piece is searched by: the server reads it from a stored row before it builds the pieces it answers. */
export const Searchable = Schema.Struct(
  Struct.pick(Piece.fields, ['name', 'notes', 'brand', 'type', 'colours', 'seasons', 'occasions', 'pattern', 'status']),
)
export type Searchable = typeof Searchable.Type

/** The catalogs' names a piece answers to in one language: its type, the words people use for the type ("tee"), its
 * group and its colours. */
const namesIn = (piece: Pick<Searchable, 'type' | 'colours'>, locale: Locale) => [
  format(locale, `wardrobe.types.${piece.type}` as const satisfies MessageKey, {}),
  format(locale, `wardrobe.typeWords.${piece.type}` as const satisfies MessageKey, {}),
  format(locale, `wardrobe.groups.${groupOf(piece.type)}` as const satisfies MessageKey, {}),
  ...piece.colours.map((colour) =>
    format(locale, `wardrobe.addPieceColor_${colour}` as const satisfies MessageKey, {}),
  ),
]

/** Every word a piece answers to, in the given languages, folded. */
export const pieceWords = (
  piece: Pick<Searchable, 'name' | 'notes' | 'brand' | 'type' | 'colours'>,
  locales: ReadonlyArray<Locale>,
) =>
  wordsIn(
    [
      piece.name ?? '',
      piece.notes ?? '',
      piece.brand ?? '',
      ...locales.flatMap((locale) => namesIn(piece, locale)),
    ].join(' '),
  )

/** Whether every word of the query matches one of the words. An empty query matches. */
export const answersQuery = (words: ReadonlyArray<string>, query: string) =>
  Array.every(wordsIn(query), (typed) => words.some((word) => wordMatches(typed, word)))

/** Whether a ready piece passes the filter, its words read in the given languages. */
export const pieceMatches = (piece: Searchable, filter: PieceFilter, locales: ReadonlyArray<Locale>) =>
  piece.status === 'ready' &&
  (filter.type === undefined || piece.type === filter.type) &&
  (filter.group === undefined || groupOf(piece.type) === filter.group) &&
  (filter.colour === undefined || piece.colours.includes(filter.colour)) &&
  (filter.season === undefined || piece.seasons.length === 0 || piece.seasons.includes(filter.season)) &&
  (filter.occasion === undefined || piece.occasions.includes(filter.occasion)) &&
  (filter.pattern === undefined || piece.pattern === filter.pattern) &&
  (filter.brand === undefined || normalise(piece.brand ?? '') === normalise(filter.brand)) &&
  answersQuery(pieceWords(piece, locales), filter.q ?? '')
