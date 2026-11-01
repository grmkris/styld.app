import { pressThenHover, style } from '../zyzz.config.ts'
export { lede as note, problem } from '../Controls.styles.ts'

// Boards: your tables (Gallery 2: docs/design/gallery-2/site/v2/boards.html).
export const page = style({ display: 'grid', gap: 'section', paddingBlock: '0 40px' })
export const head = style({ display: 'grid', gap: 'snug' })
export const intro = style({ color: 'ink2' })
/** Two boards a row on a phone, three on a tablet, and at most four as the page widens (Gallery 2's desktop strip). */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, max(150px, 22%)), 1fr))',
  gap: 'grid',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
/** A board is its paper with its name and pin count under it (Gallery 2 `.board`). No card lies around the paper,
 * so the table's corners are the tile's own. */
export const tile = style({
  display: 'grid',
  alignContent: 'start',
  gap: 'tight',
  minInlineSize: '0',
  color: 'ink',
  textDecorationLine: 'none',
  // A board's link presses, and lifts under the pointer as a piece's tile does; a loading tile stays still.
  transitionProperty: 'transform, translate',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
  '&[href]:active': { transform: 'scale(0.98)' },
  '@media (hover: hover) and (pointer: fine)': { '&[href]:hover': { translate: '0 -2px' } },
  // At a tile's size the table's 28px corner cuts into what lies near it; the list's paper takes the panel corner.
  '& [data-paper]': { borderRadius: 'panel' },
})
/** The loading tiles: the board's paper, its name and the line under it. */
export const paperSkeleton = style({ inlineSize: '100%', aspectRatio: '4 / 5', borderRadius: 'panel' })
export const nameSkeleton = style({ marginBlockStart: '4px', fontSize: 'control' })
export const metaSkeleton = style({ inlineSize: '30%', fontSize: 'small' })
export const tileName = style({
  marginBlockStart: '4px',
  fontSize: 'control',
  fontWeight: 600,
  overflowWrap: 'anywhere',
})
export const tileMeta = style({ fontSize: 'small', fontWeight: 400, color: 'ink3', fontVariantNumeric: 'tabular-nums' })
