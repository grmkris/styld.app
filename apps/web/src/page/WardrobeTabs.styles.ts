import { style } from '../zyzz.config.ts'

/** Text tabs: the current one ink, weight 600, over a 2px ink underline (DESIGN.md › Controls). */
export const tabs = style({ display: 'flex', gap: '20px', marginBlockStart: '-4px' })
export const tab = style({
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '44px',
  color: 'ink2',
  fontSize: '15px',
  fontWeight: 500,
  textDecorationLine: 'none',
  '&[aria-current="page"]': {
    color: 'ink',
    fontWeight: 600,
    textDecorationLine: 'underline',
    textDecorationColor: 'ink',
    textDecorationThickness: '2px',
    textUnderlineOffset: '8px',
  },
})
