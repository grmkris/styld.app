import { style } from '../zyzz.config.ts'

// Explore (Gallery 2: docs/design/gallery-2/site/v2/explore.html).
// One column no wider than the page, so the search pill's clear never pushes the page sideways (as on Ask).
export const page = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: '20px',
  paddingBlock: '8px 40px',
})
/** What a search found, in Explore's column. Focus lands on it after Enter without a ring, as on the page's title. */
export const results = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: '20px',
  ':focus': { outlineWidth: '0' },
})
export const searching = style({ display: 'flex', alignItems: 'center', gap: '8px', color: 'ink2' })
export const failed = style({ display: 'grid', justifyItems: 'start', gap: '12px' })
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
export const handle = style({ fontSize: '13px', color: 'ink2' })
// 8px apart, so the chips' 44px targets (4px above and below each 36px pill) don't overlap across wrapped rows.
export const chips = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
/** A mood chip is Ask's chip (DESIGN.md › Chips), filled ink when chosen. */
export const chosen = style({ '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' } })
export const empty = style({ color: 'ink2' })
