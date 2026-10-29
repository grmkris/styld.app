import { style } from '../zyzz.config.ts'

// Styles for the looks in LooksView.ts and LookView.ts (Gallery: looks.html, a board's collage).
export const looksPage = style({ display: 'grid', gap: '12px', paddingBlock: '8px 40px' })
export const lede = style({ color: 'ink2' })
/** Looks as cards: two on a phone, more on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '16px',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '24px' },
})
export const card = style({
  display: 'grid',
  gap: '6px',
  color: 'ink',
  textDecorationLine: 'none',
  transitionProperty: 'transform',
  transitionDuration: '180ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { transform: 'translateY(-2px)' } },
})
/** A look's pieces laid out together on stock: up to four, two by two. */
export const collage = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '4px',
  aspectRatio: '1 / 1',
  padding: '8px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  boxShadow: 'inset 0 0 0 1px #ddd6cc !custom',
})
export const collageImage = style({
  display: 'block',
  inlineSize: '100%',
  blockSize: '100%',
  minBlockSize: '0',
  objectFit: 'contain',
})
export const cardName = style({ fontSize: '15px', fontWeight: 600 })
export const cardMeta = style({ fontSize: '13px', color: 'ink2' })
