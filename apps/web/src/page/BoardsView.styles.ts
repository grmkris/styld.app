import { style } from '../zyzz.config.ts'

// Boards: your tables (Gallery 2: docs/design/gallery-2/site/v2/boards.html).
export const page = style({ display: 'grid', gap: '24px', paddingBlock: '0 40px' })
export const head = style({ display: 'grid', gap: '6px' })
export const intro = style({ color: 'ink2' })
export const create = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: '8px' })
export const nameField = style({ display: 'grid', gap: '6px', flex: '1 1 14rem', fontSize: '14px', fontWeight: 600 })
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
  gap: '16px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const tile = style({
  display: 'grid',
  gap: '8px',
  padding: '8px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink',
  textDecorationLine: 'none',
  boxShadow: '0 1px 2px oklch(0 0 0 / 0.05), 0 8px 24px oklch(0 0 0 / 0.05) !custom',
  transitionProperty: 'transform',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.98)' },
})
/** The loading tiles: the board's paper, its name and the line under it. */
export const paperSkeleton = style({ inlineSize: '100%', aspectRatio: '4 / 5', borderRadius: 'table' })
export const nameSkeleton = style({ marginInline: '4px', fontSize: '15px' })
export const metaSkeleton = style({ inlineSize: '30%', marginInline: '4px', fontSize: '13px' })
export const tileName = style({ paddingInline: '4px', fontSize: '15px', fontWeight: 600 })
export const tileMeta = style({ paddingInline: '4px', fontSize: '13px', fontWeight: 400, color: 'ink3' })
export const note = style({ color: 'ink2' })
export const problem = style({ fontSize: '14px', color: 'error' })
