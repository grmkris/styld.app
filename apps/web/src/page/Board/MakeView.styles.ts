import { style } from '../../zyzz.config.ts'

// Make with Styld on a board's page: the two kinds as a radio group of two cards, the person's words, and how the ask
// is going.
export const kinds = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '8px',
  paddingInline: '12px',
})
export const kind = style({
  display: 'grid',
  alignContent: 'start',
  gap: '4px',
  minBlockSize: '88px',
  padding: '12px',
  borderWidth: '1.5px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'panel',
  backgroundColor: 'paper',
  color: 'ink',
  textAlign: 'start',
  cursor: 'pointer',
  transitionProperty: 'transform, border-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-checked="true"]': { borderColor: 'ink' },
  '@media (hover: hover) and (pointer: fine)': { '&:not([aria-checked="true"]):hover': { borderColor: 'ink3' } },
})
export const kindTitle = style({ fontSize: '15px', fontWeight: 600 })
export const kindHint = style({ fontSize: '13px', color: 'ink2' })
// The field's label sits closer to its field than to the kinds above it.
export const form = style({
  display: 'grid',
  gap: '8px',
  paddingInline: '12px',
  paddingBlockStart: '12px',
  paddingBlockEnd: '4px',
})
export const label = style({ fontSize: '14px', fontWeight: 600 })
export const note = style({ fontSize: '13px', color: 'ink2' })
export const problem = style({ fontSize: '14px', color: 'error' })
export const status = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  color: 'ink2',
})
/** A picture with its mark under it. */
export const markedPicture = style({ display: 'grid', gap: '4px' })
/** The mark under a picture Styld made. */
export const generated = style({
  justifySelf: 'start',
  paddingInline: '8px',
  paddingBlock: '2px',
  borderRadius: 'pill',
  backgroundColor: 'paper',
  color: 'ink2',
  fontSize: '12px',
  fontWeight: 600,
})
