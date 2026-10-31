/** A board picture's prompt: the words it was planned from, as an editorial picture, with what it never shows. When
 * it is drawn from pieces, those pieces are its garments. Sent to the painter only; never logged. */
export const paintPrompt = (words: string, showsPieces: boolean) =>
  [
    `An editorial fashion mood picture for a style board, 4:5: ${words}.`,
    showsPieces ? 'Feature the garments in the reference pictures exactly as they are: colour, print and cut.' : '',
    'No text, no logos, no watermarks. No real, famous or recognisable person; any figure is anonymous, its face',
    'out of frame or turned away.',
  ]
    .filter((line) => line.length > 0)
    .join(' ')
