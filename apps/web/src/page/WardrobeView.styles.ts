import { style } from '../zyzz.config.ts'

// Styles for the wardrobe in WardrobeView.ts (Gallery: wardrobe.html, wardrobe-desktop.html).
export const wardrobePage = style({ display: 'grid', gap: '12px', paddingBlock: '8px 40px' })
export const pageHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' })
export const pageTitle = style({ fontSize: '30px', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.02em' })
/** The dark round action that adds a piece (Gallery `.round.dark`). */
export const addRound = style({
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
/** The loading grid: blank squares in the shape of the pieces to come. */
export const placeholder = style({ aspectRatio: '1 / 1', borderRadius: 'panel', backgroundColor: 'paper2' })
export const message = style({
  display: 'grid',
  justifyItems: 'start',
  gap: '12px',
  paddingBlock: '32px',
  color: 'ink2',
})
export const messageTitle = style({ fontSize: '17px', fontWeight: 600, color: 'ink' })
