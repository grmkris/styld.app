import { style } from '../zyzz.config.ts'

// Explore (Gallery 2: docs/design/gallery-2/site/v2/explore.html).
export const page = style({ display: 'grid', gap: '20px', paddingBlock: '8px 40px' })
export const section = style({ display: 'grid', gap: '10px' })
export const boards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
  gap: '14px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const people = style({
  display: 'flex',
  gap: '12px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
  overflowX: 'auto',
})
export const person = style({
  display: 'grid',
  justifyItems: 'center',
  gap: '4px',
  minInlineSize: '96px',
  color: 'ink',
  textDecorationLine: 'none',
})
export const personName = style({ fontSize: '14px', fontWeight: 600, textAlign: 'center' })
export const handle = style({ fontSize: '12px', color: 'ink2' })
export const chips = style({ display: 'flex', flexWrap: 'wrap', gap: '6px' })
/** A mood chip is Ask's chip (DESIGN.md › Chips), filled ink when chosen. */
export const chosen = style({ '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' } })
export const empty = style({ color: 'ink2' })
