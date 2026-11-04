import { style } from './zyzz.config.ts'

// Skeletons: quiet paper-2 shapes of what is coming (DESIGN.md › States), drawn in the space the content will take
// so nothing moves when it arrives. No shimmer.

/** A block in the shape of a picture or a card. */
export const block = style({ display: 'block', borderRadius: 'photo', backgroundColor: 'paper2' })
/** One line of text at line height 1.5: a bar of 0.75em centred in its 1.5em line. Set the font size of the text
 * it stands for. */
export const line = style({
  display: 'block',
  blockSize: '0.75em',
  marginBlock: '0.375em',
  inlineSize: '60%',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
})
