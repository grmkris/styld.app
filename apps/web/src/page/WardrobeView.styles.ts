import { pressThenHover, style } from '../zyzz.config.ts'

// Styles for the wardrobe in WardrobeView.ts (Gallery: wardrobe.html, wardrobe-desktop.html).
export const wardrobePage = style({ display: 'grid', gap: 'related', paddingBlock: '0 40px' })
/** The category cards (owner, 2026-11-03, T-07; Eva's ABOUT YOU reference): two a row on a phone, four on a wide
 * screen, each its name at the start and its newest piece at the end, on the paper's deeper tone. */
export const categories = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'related',
  margin: '0',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'grid' },
})
export const category = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 44%',
  alignItems: 'center',
  gap: 'tight',
  minBlockSize: '96px',
  paddingBlock: '10px',
  paddingInline: '14px 8px',
  borderRadius: 'photo',
  backgroundColor: 'paper2',
  color: 'ink',
  textDecorationLine: 'none',
  transitionProperty: 'transform, background-color',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
  '&:active': { transform: 'scale(0.97)' },
  '@media (hover: hover) and (pointer: fine)': { '&:hover': { backgroundColor: 'paper2Hover' } },
})
export const categoryName = style({ fontSize: 'control', fontWeight: 600, overflowWrap: 'anywhere' })
export const categoryImage = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  // A photo's pale backdrop gives way to the card, as the grid's does to the paper.
  mixBlendMode: 'darken',
})
export const categorySkeleton = style({ minBlockSize: '96px', borderRadius: 'photo' })
/** A level's head: the round back a step up, the category's name, and on a type's page its Filter button. */
export const levelHead = style({ display: 'flex', alignItems: 'center', gap: 'snug', minBlockSize: '44px' })
export const levelTitle = style({ flexGrow: 1, margin: '0', fontSize: 'subheading', fontWeight: 600 })
/** Ask's chip, chosen as Explore's is (`cx(chip(), chosen(), filterChip())`), with its count beside its name. */
export const filterChip = style({ display: 'inline-flex', alignItems: 'center', gap: 'snug' })
/** A chip's count, quieter than its name; on the chosen chip and on Filters once set it takes the on-ink colour. */
export const count = style({
  fontSize: 'small',
  fontVariantNumeric: 'tabular-nums',
  color: 'ink3',
  '[aria-pressed="true"] > &': { color: 'onInk' },
  '[data-set] > &': { color: 'onInk' },
})
/** Filters once any is set: filled in, as a chosen chip is. */
export const filtersSet = style({ '&[data-set]': { backgroundColor: 'ink', color: 'onInk' } })
/** The signature grid of pieces on paper, dense as a shop's: three columns on a phone, up to six on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 'related',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 600px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'grid' },
  '@media (min-width: 1000px)': { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', rowGap: 'grid', columnGap: 'wide' },
})
export const cut = style({
  display: 'grid',
  justifyItems: 'center',
  gap: 'tight',
  // The hover lift makes the tile its own group; on the paper's colour a photo's ground still blends into it.
  backgroundColor: 'paper',
  color: 'ink2',
  textDecorationLine: 'none',
  // It presses (Gallery `.cut:active`) and lifts under the pointer; the lift's translate composes with the press. A
  // loading tile has no link, and stays still.
  transitionProperty: 'transform, translate',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
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
/** Work in progress takes the signal colour (DESIGN.md › Signal). */
export const pieceState = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'snug',
  fontSize: 'micro',
  color: 'signal',
})
export const pieceFailed = style({ fontSize: 'micro', color: 'error' })
export const message = style({
  display: 'grid',
  justifyItems: 'start',
  gap: 'related',
  paddingBlock: '32px',
  color: 'ink2',
})
export const messageTitle = style({ fontSize: 'subheading', fontWeight: 600, color: 'ink' })
/** The filter sheet's end: Clear beside the ink action that shows what is left (DESIGN.md › Controls). */
/** Clear at the start and Show filling the rest of the row: the sheet's primary at its end, 8px apart. */
export const sheetActions = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: 'actions',
  marginBlockStart: '24px',
})
