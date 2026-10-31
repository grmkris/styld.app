import { style } from '../zyzz.config.ts'

// Styles for the wardrobe in WardrobeView.ts (Gallery: wardrobe.html, wardrobe-desktop.html).
export const wardrobePage = style({ display: 'grid', gap: '12px', paddingBlock: '0 40px' })
/** Category filters as chips with counts (DESIGN.md › Chips, Gallery 2 `.chips.scroll`): a row that scrolls,
 * cut at the screen's edge rather than the gutter. */
export const categoryRow = style({
  display: 'flex',
  gap: '8px',
  marginInline: '-20px',
  paddingInline: '20px',
  paddingBlock: '4px',
  scrollPaddingInline: '20px',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  whiteSpace: 'nowrap',
})
/** Ask's chip, chosen as Explore's is (`cx(chip(), chosen(), categoryFilter())`), with its count beside its name. */
export const categoryFilter = style({ display: 'inline-flex', alignItems: 'center', gap: '6px' })
/** A chip's count, quieter than its name; on the chosen chip it takes the on-ink colour. */
export const count = style({
  fontSize: '13px',
  fontVariantNumeric: 'tabular-nums',
  color: 'ink3',
  '[aria-pressed="true"] > &': { color: 'onInk' },
})
/** The signature grid of pieces on paper: two columns on a phone, up to six on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '16px',
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
  // A photo's pale backdrop gives way to the paper, as the looks' collage does.
  mixBlendMode: 'darken',
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
/** The line offering clean pictures for pieces without one. */
/** Pieces still without a clean picture: one quiet line, its last words the way to make them. */
export const backfill = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0 8px',
  margin: '0',
  fontSize: '14px',
  color: 'ink2',
})
