import { style } from '../../zyzz.config.ts'
export { problem } from '../../Controls.styles.ts'
// The cards sit in the grid looks use: two across on a phone, four on a wide screen.
export { grid as cards } from '../LooksView.styles.ts'

// The outfits of a "One piece, many outfits" board as cards under its table (T-10): each its flat-lay on the board's
// paper, then Keep and Another, or the look it became. Another layout sits beside their heading.
export const section = style({ display: 'grid', gap: 'related', gridColumn: '1 / -1' })
export const head = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'tight',
})
export const heading = style({ fontSize: 'control', fontWeight: 600 })
export const note = style({ fontSize: 'small', color: 'ink2' })
export const card = style({ display: 'grid', alignContent: 'start', gap: 'snug' })
export const actions = style({ display: 'flex', flexWrap: 'wrap', gap: 'tight' })
