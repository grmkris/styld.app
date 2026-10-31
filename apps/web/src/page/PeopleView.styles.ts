import { style } from '../zyzz.config.ts'

export const people = style({ display: 'grid', gap: '8px' })
export const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' })
/** Report and Block under a profile's head: quiet links in one row, centred with the head on a phone and at its end
 * beside the rail, so Follow and Share stay its only buttons. */
export const quietActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  columnGap: '20px',
  '@media (min-width: 900px)': { justifyContent: 'flex-end' },
})
/** A quiet link's shape while where the visitor stands is read, in its 44px row. */
export const quietSkeleton = style({ inlineSize: '96px', blockSize: '16px', marginBlock: '14px', borderRadius: 'pill' })
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
