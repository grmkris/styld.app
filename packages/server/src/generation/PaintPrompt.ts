import type { KeyColour } from '@styld/imaging'

const keyColours = { green: 'green #00ff00', magenta: 'magenta #ff00ff' } as const

/** The flat background a sticker is drawn on, to be keyed out: magenta when the words ask for green, else green. */
export const stickerKey = (words: string): KeyColour => (/green|zelen/i.test(words) ? 'magenta' : 'green')

/** A sticker's prompt (owner, 2026-10-31): one small decorative object or motif from the person's words, drawn on a
 * flat key colour so it can be cut out. Never a garment to wear, a real person, text or a logo. Sent to the painter
 * only; never logged. */
export const stickerPrompt = (words: string, key: KeyColour) =>
  [
    `A single small decorative sticker for a fashion mood board, as a cut-out illustration: ${words}.`,
    'One object or motif, whole and centred with clearance on every side; no clothing to wear, no person, no face,',
    'no text, no logos, no watermarks.',
    `One completely flat bright ${keyColours[key]} background with no gradient, shadow or reflection.`,
  ].join(' ')
