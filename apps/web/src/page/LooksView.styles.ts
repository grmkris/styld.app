import { style } from '../zyzz.config.ts'

// Styles for the looks in LooksView.ts and LookView.ts (Gallery: looks.html, a board's collage).
export const looksPage = style({ display: 'grid', gap: '12px', paddingBlock: '0 40px' })
export const lede = style({ color: 'ink2' })
/** A look's own page starts 8px down, as a piece's, the tray and Add clothes do, so its back sits where theirs do. */
export const lookPage = style({ paddingBlockStart: '8px' })
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
/** A look's own page while it loads: the h1 (30px at 1.08 over `line`) and a piece row's 56px. */
export const titleSkeleton = style({ fontSize: '30px', blockSize: '0.54em', marginBlock: '0.27em', inlineSize: '50%' })
export const rowSkeleton = style({ blockSize: '56px', borderRadius: 'field' })
export const metaSkeleton = style({ inlineSize: '40%', fontSize: '13px' })
/** A count or a kind under a name: body weight, not the link's semibold it sits in, as Boards' pin count is. */
export const cardMeta = style({ fontSize: '13px', fontWeight: 400, color: 'ink2', fontVariantNumeric: 'tabular-nums' })
/** A look's own page: where it stands under the title, the look laid out large, then its pieces as rows. */
export const status = style({ fontSize: '14px', color: 'ink2' })
export const lookCollage = style({ maxInlineSize: '420px' })
export const pieces = style({ display: 'grid', gap: '8px', paddingBlockStart: '8px' })
export const piecesTitle = style({ fontSize: '17px' })
export const pieceRows = style({ display: 'grid', gap: '4px', margin: '0', padding: '0', listStyleType: 'none' })
export const pieceRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  minBlockSize: '56px',
  color: 'ink',
  textDecorationLine: 'none',
})
export const pieceRowImage = style({
  flex: 'none',
  inlineSize: '48px',
  blockSize: '48px',
  padding: '4px',
  objectFit: 'contain',
  borderRadius: 'field',
  backgroundColor: 'paper',
  boxShadow: 'edge',
  mixBlendMode: 'darken',
})
export const pieceRowText = style({ display: 'grid', minInlineSize: '0' })
export const pieceRowName = style({ fontSize: '15px', fontWeight: 600 })
/** Deleting the look: a quiet text action at the end, after the pieces. */
export const deletion = style({ display: 'grid', justifyItems: 'start', gap: '8px', paddingBlockStart: '8px' })
/** A wish whose piece is no longer public: the line under its name. */
export const goneNote = style({ paddingInline: '4px', fontSize: '13px', color: 'ink2' })
