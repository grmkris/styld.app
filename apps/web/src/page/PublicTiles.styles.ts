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
/** Whose a board is, inside its card under the meta. */
export const credit = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'snug',
  minInlineSize: '0',
  paddingInline: '4px',
  paddingBlockEnd: '4px',
  fontSize: 'small',
  color: 'ink2',
})
