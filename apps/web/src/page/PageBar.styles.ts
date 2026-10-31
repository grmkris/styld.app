import { style } from '../zyzz.config.ts'

// Styles for the top of the wardrobe's pages in PageBar.ts.
/** A 44px round icon action (Gallery `.round`): back, or a button that closes what is open. */
export const round = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  cursor: 'pointer',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
/** A round that starts a page bar: its icon, not its 44px target, lines up with the gutter and the title below. */
export const barStart = style({ marginInlineStart: '-12px' })
/** A round that ends a page bar: its icon lines up with the gutter at the other edge. */
export const barEnd = style({ marginInlineEnd: '-12px' })
