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
/** A mood chip (DESIGN.md › Chips): paper-2 in ink-2 at rest, filled ink when chosen, a 44px target. */
export const chip = style({
  position: 'relative',
  minBlockSize: '36px',
  paddingInline: '14px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink2',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '::after': { content: '""', position: 'absolute', insetInline: '0', insetBlock: '-4px' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2Hover' } },
  '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' },
})
export const empty = style({ color: 'ink2' })
