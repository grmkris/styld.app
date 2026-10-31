import { style } from '../zyzz.config.ts'

// Boards: your tables (Gallery 2: docs/design/gallery-2/site/v2/boards.html).
export const page = style({ display: 'grid', gap: '24px', paddingBlock: '0 40px' })
export const head = style({ display: 'grid', gap: '6px' })
export const intro = style({ color: 'ink2' })
/** Two boards a row on a phone, three on a tablet, and at most four as the page widens (Gallery 2's desktop strip). */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, max(150px, 22%)), 1fr))',
  gap: '16px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
/** A board is its paper with its name and pin count under it (Gallery 2 `.board`). No card lies around the paper,
 * so the table's corners are the tile's own. */
export const tile = style({
  display: 'grid',
  alignContent: 'start',
  gap: '4px',
  minInlineSize: '0',
  color: 'ink',
  textDecorationLine: 'none',
  transitionProperty: 'transform',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.98)' },
  // At a tile's size the table's 28px corner cuts into what lies near it; the list's paper takes the panel corner.
  '& [data-paper]': { borderRadius: 'panel' },
})
/** The loading tiles: the board's paper, its name and the line under it. */
export const paperSkeleton = style({ inlineSize: '100%', aspectRatio: '4 / 5', borderRadius: 'table' })
export const nameSkeleton = style({ marginBlockStart: '4px', fontSize: '15px' })
export const metaSkeleton = style({ inlineSize: '30%', fontSize: '13px' })
export const tileName = style({ marginBlockStart: '4px', fontSize: '15px', fontWeight: 600, overflowWrap: 'anywhere' })
export const tileMeta = style({ fontSize: '13px', fontWeight: 400, color: 'ink3', fontVariantNumeric: 'tabular-nums' })
export const note = style({ color: 'ink2' })
export const problem = style({ fontSize: '14px', color: 'error' })
