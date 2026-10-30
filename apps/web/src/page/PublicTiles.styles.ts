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
})
/** A board without a collage shows its newest pins two by two. */
export const cover = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '4px',
  aspectRatio: '4 / 5',
  pointerEvents: 'none',
})
export const coverTile = style({ display: 'grid', minBlockSize: '0' })
export const boardName = style({ paddingInline: '4px', fontWeight: 600 })
export const meta = style({ paddingInline: '4px', fontSize: '13px', color: 'ink2' })
