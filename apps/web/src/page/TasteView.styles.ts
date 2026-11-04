import { style } from '../zyzz.config.ts'

export { chip, chosen, problem } from '../Controls.styles.ts'

// What Styld knows about you, on the Account page: a small heading per part, the occasions as chips, the notes as a
// plain list with Remove at each line's end.

export const partTitle = style({ margin: '0', fontSize: 'label', fontWeight: 600 })
export const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
export const notes = style({ display: 'grid', gap: 'snug', margin: '0', padding: '0', listStyle: 'none' })
/** One note and its Remove, on one line when they fit. */
export const noteRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'actions',
  fontSize: 'control',
  overflowWrap: 'anywhere',
})
export const quiet = style({ margin: '0', fontSize: 'label', color: 'ink2', lineHeight: 1.5 })
