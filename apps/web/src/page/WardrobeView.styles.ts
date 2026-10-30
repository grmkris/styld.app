import { style } from '../zyzz.config.ts'

// Styles for the wardrobe in WardrobeView.ts (Gallery: wardrobe.html, wardrobe-desktop.html).
export const wardrobePage = style({ display: 'grid', gap: '12px', paddingBlock: '0 40px' })
/** Category filters as text with counts; the current one is ink and bold (Gallery `.cats`). */
export const categoryRow = style({
  display: 'flex',
  gap: '20px',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  whiteSpace: 'nowrap',
})
export const categoryFilter = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  minBlockSize: '44px',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  color: 'ink2',
  fontSize: '15px',
  fontWeight: 500,
  cursor: 'pointer',
  '&[aria-pressed="true"]': { color: 'ink', fontWeight: 700 },
})
export const count = style({ fontSize: '13px', fontWeight: 500, color: 'ink3' })
/** The signature grid of pieces on paper: two columns on a phone, up to six on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '12px 16px',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 600px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  '@media (min-width: 1000px)': { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '16px 28px' },
})
export const cut = style({
  display: 'grid',
  justifyItems: 'center',
  gap: '4px',
  color: 'ink2',
  textDecorationLine: 'none',
  transitionProperty: 'transform',
  transitionDuration: '180ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { transform: 'translateY(-2px)' } },
})
export const cutImage = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'photo',
})
export const caption = style({
  maxInlineSize: '100%',
  overflow: 'hidden',
  fontSize: '13px',
  fontWeight: 500,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
/** Work in progress takes the signal colour (DESIGN.md › Signal). */
export const pieceState = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '12px',
  color: 'signal',
})
export const pieceFailed = style({ fontSize: '12px', color: 'error' })
/** The loading row and grid: the category row's height, and squares with captions where the pieces will be. */
export const categoryRowSkeleton = style({ display: 'flex', alignItems: 'center', gap: '20px', minBlockSize: '44px' })
export const filterSkeleton = style({ inlineSize: '56px', fontSize: '15px' })
export const tileSkeleton = style({ inlineSize: '100%', aspectRatio: '1 / 1' })
export const captionSkeleton = style({ fontSize: '13px' })
export const message = style({
  display: 'grid',
  justifyItems: 'start',
  gap: '12px',
  paddingBlock: '32px',
  color: 'ink2',
})
export const messageTitle = style({ fontSize: '17px', fontWeight: 600, color: 'ink' })
