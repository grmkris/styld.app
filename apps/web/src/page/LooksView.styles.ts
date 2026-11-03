import { cutoutGlow, pressThenHover, style } from '../zyzz.config.ts'
export { lede } from '../Controls.styles.ts'

// Styles for the looks in LooksView.ts and LookView.ts (Gallery: looks.html, a board's collage).
export const looksPage = style({ display: 'grid', gap: 'related', paddingBlock: '0 40px' })
/** A look's own page starts 8px down, as a piece's, the tray and Add clothes do, so its back sits where theirs do. */
export const lookPage = style({ paddingBlockStart: '8px' })
/** Looks as cards: two on a phone, more on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'grid',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'section' },
})
export const card = style({
  display: 'grid',
  gap: 'snug',
  color: 'ink',
  textDecorationLine: 'none',
  // It presses, at a large tile's 0.98, and lifts under the pointer; the lift's translate composes with the press. A
  // loading card has no link, and stays still.
  transitionProperty: 'transform, translate',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
  '&[href]:active': { transform: 'scale(0.98)' },
  '@media (hover: hover) and (pointer: fine)': { '&[href]:hover': { translate: '0 -2px' } },
})
/** A look's pieces laid out together on paper, as pieces you own are (DESIGN › Surfaces): up to four, two by two; with
 * three, the first takes the left column. */
export const collage = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
  gap: 'tight',
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
  // DESIGN.md › Dark: no blend on the dark paper, where darken would sink a dark garment.
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
})
export const cardName = style({ fontSize: 'control', fontWeight: 600 })
/** The loading cards: the pieces' square, the name and the line under it. */
export const collageSkeleton = style({ inlineSize: '100%', aspectRatio: '1 / 1', borderRadius: 'panel' })
export const nameSkeleton = style({ fontSize: 'control' })
/** A look's own page while it loads: the h1 (30px at 1.08 over `line`) and a piece row's 56px. */
export const titleSkeleton = style({ fontSize: 'title', blockSize: '0.54em', marginBlock: '0.27em', inlineSize: '50%' })
export const rowSkeleton = style({ blockSize: '56px', borderRadius: 'field' })
export const metaSkeleton = style({ inlineSize: '40%', fontSize: 'small' })
/** A count or a kind under a name: body weight, not the link's semibold it sits in, as Boards' pin count is. */
export const cardMeta = style({ fontSize: 'small', fontWeight: 400, color: 'ink2', fontVariantNumeric: 'tabular-nums' })
/** A look's own page: where it stands under the title, the look laid out large, then its pieces as rows. */
export const status = style({ fontSize: 'label', color: 'ink2' })
export const lookCollage = style({ maxInlineSize: '420px' })
export const pieces = style({ display: 'grid', gap: 'actions', paddingBlockStart: '8px' })
export const piecesTitle = style({ fontSize: 'subheading' })
export const pieceRows = style({ display: 'grid', gap: 'tight', margin: '0', padding: '0', listStyleType: 'none' })
export const pieceRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'related',
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
  // DESIGN.md › Dark: no blend on the dark paper, where darken would sink a dark garment.
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal' },
})
export const pieceRowText = style({ display: 'grid', minInlineSize: '0' })
export const pieceRowName = style({ fontSize: 'control', fontWeight: 600 })
/** Deleting the look: a quiet text action at the end, after the pieces. */
export const deletion = style({ display: 'grid', justifyItems: 'start', gap: 'actions', paddingBlockStart: '8px' })
