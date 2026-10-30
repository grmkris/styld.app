import { style } from '../zyzz.config.ts'

// The top of a tab page in PageHead.ts (Gallery 2 `.head`): every tab page's title starts at the same height.

/** 8px under the top bar, then one row at least 44px tall: the title at its start, the round action or an empty
 * slot of the same size at its end. */
export const head = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  minBlockSize: '52px',
  paddingBlockStart: '8px',
})
/** The title fills the row, so its box starts at the row's top whatever its size; its words sit in the middle. */
export const title = style({ display: 'flex', alignItems: 'center', minBlockSize: '44px', minInlineSize: '0' })
export const slot = style({ flex: 'none', inlineSize: '44px', blockSize: '44px' })
/** The dark round action (Gallery `.round.dark`), such as adding a piece. */
export const roundAction = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  flex: 'none',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'inkHover' } },
})
