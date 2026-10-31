import { style } from '../zyzz.config.ts'

/** Text tabs: the current one ink, weight 600, over a 2px ink underline (DESIGN.md › Controls). Every tab is set
 * at 600, so switching changes colour and underline only and the row never shifts. */
export const tabs = style({
  display: 'flex',
  gap: '20px',
  // On a phone the tabs take a row of their own under the title and the +.
  order: 3,
  flexBasis: '100%',
  marginBlockStart: '-4px',
  '@media (min-width: 900px)': { order: 2, flexBasis: 'auto', flexGrow: 1, marginBlockStart: '0' },
})
/** The tabs' head, the page head's row (PageHead.styles.ts › head) with the tabs as one more item. */
export const head = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0 12px',
  minBlockSize: '52px',
  paddingBlockStart: '8px',
  '& > h1': { order: 1 },
  '& > a': { order: 2 },
  '@media (min-width: 900px)': { gap: '0 32px', '& > a': { order: 3 } },
})
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
