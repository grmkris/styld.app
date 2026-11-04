import { format, type Locale } from '@styld/i18n'
import { groupOf, type Piece, wordMatches, wordsIn } from '@styld/protocol'
import { Array } from 'effect'
import { colourName, groupName, typeName, typeWordsName } from './WardrobeWords.ts'

// Ask's search over the person's own pieces, folding text as `@styld/protocol`'s Search does. Every word of the
// query must match a word the piece answers to, in either language.

/** Everything a piece answers to: its name, notes and brand, and in each language its type with the words people use
 * for it, its group and its colours. */
const wordsOf = (piece: Piece, locales: ReadonlyArray<Locale>) =>
  wordsIn(
    [
      piece.name ?? '',
      piece.notes ?? '',
      piece.brand ?? '',
      ...locales.flatMap((locale) => [
        format(locale, typeName(piece.type), {}),
        format(locale, typeWordsName(piece.type), {}),
        format(locale, groupName(groupOf(piece.type)), {}),
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

/** Whether something made of pieces (a look, an outfit photo, a try-on) answers the query: every word of it matches
 * the thing's name or one of its pieces. An empty query matches everything. */
export const wearsMatching = (
  name: string,
  pieces: ReadonlyArray<Piece>,
  query: string,
  locales: ReadonlyArray<Locale>,
): boolean => {
  const words = [...wordsIn(name), ...pieces.flatMap((piece) => wordsOf(piece, locales))]
  return Array.every(wordsIn(query), (token) => words.some((word) => wordMatches(token, word)))
}
