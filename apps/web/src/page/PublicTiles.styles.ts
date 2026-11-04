import { pressThenHover, style } from '../zyzz.config.ts'

export const byline = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'actions',
  minBlockSize: '44px',
  color: 'ink',
  fontSize: 'label',
  fontWeight: 600,
  textDecorationLine: 'none',
})
export const boardCard = style({
  display: 'grid',
  gap: 'snug',
  padding: '8px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink',
  textDecorationLine: 'none',
  // It presses and lifts under the pointer, as a board's tile does on Boards.
  transitionProperty: 'transform, translate',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.98)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { translate: '0 -2px' } },
  // The face's paper inside the card keeps concentric corners: the card's 16px less its 8px padding.
  '& [data-paper]': { borderRadius: 'inset' },
})
export const boardName = style({ paddingInline: '4px', fontWeight: 600 })
export const meta = style({ paddingInline: '4px', fontSize: 'small', color: 'ink2' })

/** Public boards as cards in a grid: the landing's and Ask's people-and-boards results. */
export const boards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
  gap: 'cozy',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
/** People in one row that scrolls sideways (Ask's results). */
export const people = style({
  display: 'flex',
  gap: 'related',
  margin: '0',
  padding: '0',
  listStyle: 'none',
  overflowX: 'auto',
})
export const person = style({
  display: 'grid',
  justifyItems: 'center',
  gap: 'tight',
  minInlineSize: '96px',
  color: 'ink',
  textDecorationLine: 'none',
})
export const personName = style({ fontSize: 'label', fontWeight: 600, textAlign: 'center' })
export const handle = style({ fontSize: 'small', color: 'ink2' })
