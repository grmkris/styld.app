import { Array, String } from 'effect'

// How Styld folds text for search, the same on the device and on the server: any case, with or without č, š and ž,
// commas or not, and Slovenian (or English) word endings.

const marks = /\p{M}/gu
const notLetters = /[^\p{L}\p{N}]+/gu
/** đ has no accent to take off: it is a letter of its own. */
const strokedD = /đ/gu
/** Endings stripped before comparing two words, longest first: Slovenian cases and numbers, and an English plural. */
const endings = ['ega', 'emu', 'ami', 'ih', 'im', 'om', 'em', 'ov', 'ev', 'ah', 'es', 'a', 'e', 'i', 'o', 'u', 's']

/** Lowercase, without accents (č → c, đ → d), with anything but letters and digits between words. */
export const normalise = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(marks, '').replace(strokedD, 'd').replace(notLetters, ' ').trim()

/** The words of a text, folded. */
export const wordsIn = (text: string) => Array.filter(String.split(normalise(text), ' '), String.isNonEmpty)

/** A word without its ending, when at least three letters stay: `jakna` and `jakne` are both `jakn`. */
export const stem = (word: string) => {
  const ending = endings.find((candidate) => word.endsWith(candidate) && word.length - candidate.length >= 3)
  return ending === undefined ? word : word.slice(0, -ending.length)
}

/** A word typed so far matches the start of a word, or the same word with another ending. */
export const wordMatches = (typed: string, word: string) =>
  word.startsWith(typed) || (typed.length >= 3 && stem(typed) === stem(word))

/** A text as stored for searching on the server: its folded words, each led by a space, so a query matches a
 * word's start with `LIKE '% word%'`. */
export const searchText = (...parts: ReadonlyArray<string | null>) =>
  wordsIn(parts.filter((part) => part !== null).join(' '))
    .map((word) => ` ${word}`)
    .join('')
