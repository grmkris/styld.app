import { style } from '../zyzz.config.ts'

export const byline = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  minBlockSize: '44px',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 600,
  textDecorationLine: 'none',
})
export const boardCard = style({
  display: 'grid',
  gap: '6px',
  padding: '8px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink',
  textDecorationLine: 'none',
  ':active': { transform: 'scale(0.98)' },
  // The face's paper inside the card keeps concentric corners: the card's 16px less its 8px padding.
  '& [data-paper]': { borderRadius: 'inset' },
})
export const boardName = style({ paddingInline: '4px', fontWeight: 600 })
export const meta = style({ paddingInline: '4px', fontSize: '13px', color: 'ink2' })
/** Whose a board is, inside its card under the meta. */
export const credit = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  minInlineSize: '0',
  paddingInline: '4px',
  paddingBlockEnd: '4px',
  fontSize: '13px',
  color: 'ink2',
})
