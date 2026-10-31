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
/** People to follow, two across on a phone (the prototype's `.pcards`). */
export const cards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))',
  gap: '16px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
/** A person's card: stock above the paper, its parts 12px apart, Follow at the foot even beside a taller card. */
export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  minInlineSize: '0',
  padding: '12px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
export const cardTop = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minInlineSize: '0',
  color: 'ink',
  textDecorationLine: 'none',
})
export const cardWho = style({ display: 'grid', minInlineSize: '0' })
/** The whole name, wrapping where it must: a card two across has no room to cut it short and still say who. */
export const cardName = style({ overflowWrap: 'anywhere', fontSize: '15px', fontWeight: 600 })
export const cardCity = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px',
  color: 'ink2',
})
/** One line of the bio; the rest is on their profile. */
export const cardBio = style({
  overflow: 'hidden',
  margin: '0',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px',
  color: 'ink2',
})
/** The prototype's soft full-width button: paper-2, 40px tall, 14px, with a 44px target. */
export const follow = style({
  position: 'relative',
  display: 'flex',
  marginBlockStart: 'auto',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  inlineSize: '100%',
  minBlockSize: '40px',
  paddingInline: '12px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  textDecorationLine: 'none',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '::after': { content: '""', position: 'absolute', insetInline: '0', insetBlock: '-2px' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2Hover' } },
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
})
export const problem = style({ margin: '0', fontSize: '13px', color: 'error' })
export const chips = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
/** A mood chip is Ask's chip (DESIGN.md › Chips), filled ink when chosen. */
export const chosen = style({ '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' } })
export const empty = style({ color: 'ink2' })
/** A board card's shape while Explore loads. */
export const boardSkeleton = style({ aspectRatio: '4 / 5', borderRadius: 'panel' })
/** A person's card while Explore loads: its padding round the avatar's row, a line of bio and Follow, 12px apart. */
export const cardSkeleton = style({ blockSize: '152px', borderRadius: 'panel' })
