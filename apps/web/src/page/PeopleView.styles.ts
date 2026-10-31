import { style } from '../zyzz.config.ts'

export const people = style({ display: 'grid', gap: '8px' })
export const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' })
/** One action's shape while where the visitor stands is read: an action's height (Actions.styles.ts). */
export const actionSkeleton = style({ inlineSize: '96px', blockSize: '48px', borderRadius: 'pill' })
/** Save on someone else's piece, look or board: a 44px round ringed like a secondary action, filled ink once saved. */
export const save = style({
  display: 'inline-grid',
  flex: 'none',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '1.5px',
  borderStyle: 'solid',
  borderColor: 'ink',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color, color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-pressed="true"]': { backgroundColor: 'ink', color: 'onInk' },
  '@media (hover: hover) and (pointer: fine)': {
    '&:not([aria-pressed="true"]):hover': { backgroundColor: 'paper2' },
    '&[aria-pressed="true"]:hover': { backgroundColor: 'inkHover' },
  },
})
/** The report form and the block question: a panel that reads from the start even in a centred profile head. */
export const report = style({
  display: 'grid',
  gap: '10px',
  padding: '12px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  textAlign: 'start',
})
export const reasons = style({ display: 'grid', gap: '4px', margin: '0', padding: '0', borderWidth: '0' })
export const reason = style({ display: 'flex', alignItems: 'center', gap: '8px', minBlockSize: '36px' })
export const field = style({ display: 'grid', gap: '6px', fontSize: '14px', fontWeight: 600 })
export const note = style({ margin: '0', fontSize: '14px', color: 'ink2' })
export const problem = style({ margin: '0', fontSize: '14px', color: 'error' })
/** More at the end of a profile's bar. */
export const more = style({ display: 'contents' })
/** One choice in the More sheet: a full-width row as Ask's + sheet draws its ways in. */
export const moreOption = style({
  display: 'flex',
  alignItems: 'center',
  inlineSize: '100%',
  minBlockSize: '52px',
  paddingInline: '12px',
  borderWidth: '0',
  borderRadius: 'panel',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  fontSize: 'inherit',
  fontWeight: 600,
  textAlign: 'start',
  cursor: 'pointer',
  gap: '8px',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-busy="true"]': { cursor: 'progress' },
  '&[aria-busy="true"]:active': { transform: 'none' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
/** The report form in the More sheet: its own 12px padding puts its words on the title's line. */
export const moreFlush = style({ paddingInline: '0' })
/** A failed unblock in the More sheet, on the title's line above the rows. */
export const moreProblem = style({ paddingInline: '12px' })
/** A question or the report form in the More sheet, on the title's line, scrolling within the sheet if long. */
export const moreBody = style({
  display: 'grid',
  gap: '12px',
  maxBlockSize: '72dvh',
  overflowY: 'auto',
  paddingInline: '12px',
  paddingBlockEnd: '4px',
})
