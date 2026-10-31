import { style } from '../zyzz.config.ts'

// Styles for the wardrobe in WardrobeView.ts (Gallery: wardrobe.html, wardrobe-desktop.html).
export const wardrobePage = style({ display: 'grid', gap: '12px', paddingBlock: '0 40px' })
/** Browsing as a shop does (owner, 2026-10-31): a row of groups, then a row of the chosen group's types, each chip
 * with its count (DESIGN.md › Chips, Gallery 2 `.chips.scroll`): a row that scrolls, cut at the screen's edge rather
 * than the gutter. */
export const filterRow = style({
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
/** Ask's chip, chosen as Explore's is (`cx(chip(), chosen(), filterChip())`), with its count beside its name. */
export const filterChip = style({ display: 'inline-flex', alignItems: 'center', gap: '6px' })
/** A chip's count, quieter than its name; on the chosen chip and on Filters once set it takes the on-ink colour. */
export const count = style({
  fontSize: '13px',
  fontVariantNumeric: 'tabular-nums',
  color: 'ink3',
  '[aria-pressed="true"] > &': { color: 'onInk' },
  '[data-set] > &': { color: 'onInk' },
})
/** Filters pinned at the start of the groups' row, which scrolls beside it. */
export const browseRow = style({ display: 'flex', alignItems: 'center', gap: '8px' })
/** The groups' row beside Filters: cut at the screen's right edge only. */
export const groupScroll = style({ flexGrow: 1, minInlineSize: '0', marginInlineStart: '0', paddingInlineStart: '0' })
/** Filters once any is set: filled in, as a chosen chip is. */
export const filtersSet = style({ '&[data-set]': { backgroundColor: 'ink', color: 'onInk' } })
/** The signature grid of pieces on paper, dense as a shop's: three columns on a phone, up to six on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '12px',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 600px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '16px' },
  '@media (min-width: 1000px)': { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '16px 28px' },
})
export const cut = style({
  display: 'grid',
  justifyItems: 'center',
  gap: '4px',
  // The hover lift makes the tile its own group; on the paper's colour a photo's ground still blends into it.
  backgroundColor: 'paper',
  color: 'ink2',
  textDecorationLine: 'none',
  // It presses (Gallery `.cut:active`) and lifts under the pointer; the lift's translate composes with the press. A
  // loading tile has no link, and stays still.
  transitionProperty: 'transform, translate',
  transitionDuration: '140ms, 180ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  '&[href]:active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { '&[href]:hover': { translate: '0 -2px' } },
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
/** The filter chips' row while the pieces load: pills where the chips will be (AskView.styles.ts › chipSkeleton). */
export const filterRowSkeleton = style({ display: 'flex', alignItems: 'center', gap: '8px', minBlockSize: '44px' })
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
/** The filter sheet's end: Clear beside the ink action that shows what is left (DESIGN.md › Controls). */
export const sheetActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  marginBlockStart: '24px',
})
