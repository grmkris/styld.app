import { style } from './zyzz.config.ts'

// The small shared controls and text roles every page draws the same way (DESIGN.md › Controls); buttons live in
// Actions.styles.ts and sheets in page/Sheet.styles.ts. Page style modules re-export what they use under their own
// names, so a page's view keeps reading its one `styles` namespace.

/** A chip (DESIGN.md › Chips): a 36px paper-2 pill with a 44px target. */
export const chip = style({
  position: 'relative',
  flex: 'none',
  minBlockSize: '36px',
  paddingInline: '14px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink2',
  fontSize: 'label',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  // A 36px pill with a 44px target (DESIGN.md › Controls).
  '::after': { content: '""', position: 'absolute', insetInline: '0', insetBlock: '-4px' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2Hover' } },
})
/** A chip's shape while what it offers loads. */
export const chipSkeleton = style({ flex: 'none', inlineSize: '72px', blockSize: '36px', borderRadius: 'pill' })
/** The chosen chip, filled ink. */
export const chosen = style({ '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' } })

/** A quiet line in ink-2 at the body's size: a lede under a page's title, or what an empty list says. */
export const lede = style({ color: 'ink2' })
/** A small note in ink-2. */
export const note = style({ fontSize: 'label', color: 'ink2' })
/** A small problem in the error colour, under what it is about. */
export const problem = style({ fontSize: 'label', color: 'error' })

/** A row of actions, 8px apart, wrapping on a narrow screen (DESIGN.md › Spacing). */
export const actionRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'actions' })
/** A page's bar: Back at the start, its own actions at the end. */
export const pageBar = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'actions' })
