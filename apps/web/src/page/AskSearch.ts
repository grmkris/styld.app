import type { Locale } from '@styld/i18n'
import { answersQuery, type Piece, pieceMatches, pieceWords, wordsIn } from '@styld/protocol'
import { Array } from 'effect'

// Ask's search over the person's own pieces: the one piece search of `@styld/protocol` (`PieceSearch.ts`), which the
// assistants and Styld's chat use too. Every word of the query must match a word the piece answers to, in either
// language.

/** The ready pieces that match every word of the query, in the given languages. An empty query matches them all. */
export const matching = (
  pieces: ReadonlyArray<Piece>,
  query: string,
  locales: ReadonlyArray<Locale>,
): ReadonlyArray<Piece> => Array.filter(pieces, (piece) => pieceMatches(piece, { q: query }, locales))

/** Whether something made of pieces (a look, an outfit photo, a try-on) answers the query: every word of it matches
 * the thing's name or one of its pieces. An empty query matches everything. */
export const wearsMatching = (
  name: string,
  pieces: ReadonlyArray<Piece>,
  query: string,
  locales: ReadonlyArray<Locale>,
): boolean => answersQuery([...wordsIn(name), ...pieces.flatMap((piece) => pieceWords(piece, locales))], query)
