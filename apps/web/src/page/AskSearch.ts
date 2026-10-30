import { format, type Locale } from '@styld/i18n'
import type { Piece } from '@styld/protocol'
import { Array, String } from 'effect'
import { categoryName, colourName, searchWordsName, subcategoryName } from './WardrobeWords.ts'

// Ask's search over the person's own pieces, forgiving the way people type: any case, with or without č, š and ž,
// commas or not, and Slovenian (or English) word endings. Every word of the query must match a word the piece
// answers to, in either language.

const marks = /\p{M}/gu
const notLetters = /[^\p{L}\p{N}]+/gu
/** đ has no accent to take off: it is a letter of its own. */
const strokedD = /đ/gu
/** Endings stripped before comparing two words, longest first: Slovenian cases and numbers, and an English plural. */
const endings = ['ega', 'emu', 'ami', 'ih', 'im', 'om', 'em', 'ov', 'ev', 'ah', 'es', 'a', 'e', 'i', 'o', 'u', 's']

/** Lowercase, without accents (č → c, đ → d), with anything but letters and digits between words.
 * @internal Exported for its tests. */
export const normalise = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(marks, '').replace(strokedD, 'd').replace(notLetters, ' ').trim()

const wordsIn = (text: string) => Array.filter(String.split(normalise(text), ' '), String.isNonEmpty)

/** A word without its ending, when at least three letters stay: `jakna` and `jakne` are both `jakn`. */
const stem = (word: string) => {
  const ending = endings.find((candidate) => word.endsWith(candidate) && word.length - candidate.length >= 3)
  return ending === undefined ? word : word.slice(0, -ending.length)
}

/** A word typed so far matches the start of a word, or the same word with another ending. */
const wordMatches = (typed: string, word: string) =>
  word.startsWith(typed) || (typed.length >= 3 && stem(typed) === stem(word))

/** Everything a piece answers to: its name and notes, and in each language its category with the words people
 * use for it, its shelf and its colours. */
const wordsOf = (piece: Piece, locales: ReadonlyArray<Locale>) =>
  wordsIn(
    [
      piece.name ?? '',
      piece.notes ?? '',
      ...locales.flatMap((locale) => [
        format(locale, categoryName(piece.category), {}),
        format(locale, searchWordsName(piece.category), {}),
        piece.subcategory === null ? '' : format(locale, subcategoryName(piece.subcategory), {}),
        ...piece.colours.map((colour) => format(locale, colourName(colour), {})),
      ]),
    ].join(' '),
  )

/** The ready pieces that match every word of the query, in the given languages. An empty query matches them all. */
export const matching = (
  pieces: ReadonlyArray<Piece>,
  query: string,
  locales: ReadonlyArray<Locale>,
): ReadonlyArray<Piece> => {
  const typed = wordsIn(query)
  return Array.filter(pieces, (piece) => {
    if (piece.status !== 'ready') return false
    const words = wordsOf(piece, locales)
    return Array.every(typed, (token) => words.some((word) => wordMatches(token, word)))
  })
}
