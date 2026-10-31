import { style } from '../zyzz.config.ts'

export const people = style({ display: 'grid', gap: '8px' })
export const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' })
/** One action's shape while where the visitor stands is read: an action's height (Actions.styles.ts). */
export const actionSkeleton = style({ inlineSize: '96px', blockSize: '48px', borderRadius: 'pill' })
export const signIn = style({ display: 'inline-flex', alignItems: 'center', minBlockSize: '44px', fontWeight: 600 })
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
