import { style } from '../zyzz.config.ts'

/** Text tabs: the current one ink, weight 600, over a 2px ink underline (DESIGN.md › Controls). Every tab is set
 * at 600, so switching changes colour and underline only and the row never shifts. */
export const tabs = style({ display: 'flex', gap: '20px', marginBlockStart: '-4px' })
export const tab = style({
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '44px',
  color: 'ink2',
  fontSize: '15px',
  fontWeight: 600,
  textDecorationLine: 'none',
  '&[aria-current="page"]': {
    color: 'ink',
    textDecorationLine: 'underline',
    textDecorationColor: 'ink',
    textDecorationThickness: '2px',
    textUnderlineOffset: '8px',
  },
})
