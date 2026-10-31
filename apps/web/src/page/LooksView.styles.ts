import { style } from '../zyzz.config.ts'

// Styles for the looks in LooksView.ts and LookView.ts (Gallery: looks.html, a board's collage).
export const looksPage = style({ display: 'grid', gap: '12px', paddingBlock: '0 40px' })
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
/** A look's pieces laid out together on paper, as pieces you own are (DESIGN › Surfaces): up to four, two by two; with
 * three, the first takes the left column. */
export const collage = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
  gap: '4px',
  aspectRatio: '1 / 1',
  padding: '8px',
  borderRadius: 'panel',
  backgroundColor: 'paper',
  boxShadow: 'edge',
  '&:has(> :nth-child(3):last-child) > :first-child': { gridRow: '1 / span 2' },
})
/** A picture's pale backdrop gives way to the paper under it, so a photo reads as near to a cutout as it can. */
export const collageImage = style({
  display: 'block',
  inlineSize: '100%',
  blockSize: '100%',
  minBlockSize: '0',
  objectFit: 'contain',
  mixBlendMode: 'darken',
})
export const cardName = style({ fontSize: '15px', fontWeight: 600 })
/** The loading cards: the pieces' square, the name and the line under it. */
export const collageSkeleton = style({ inlineSize: '100%', aspectRatio: '1 / 1', borderRadius: 'panel' })
export const nameSkeleton = style({ fontSize: '15px' })
export const metaSkeleton = style({ inlineSize: '40%', fontSize: '13px' })
export const cardMeta = style({ fontSize: '13px', color: 'ink2' })
/** A wish whose piece is no longer public: the line under its name. */
export const goneNote = style({ paddingInline: '4px', fontSize: '13px', color: 'ink2' })
