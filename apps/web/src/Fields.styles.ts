import { style } from './zyzz.config.ts'

// Form fields shared by every page (DESIGN.md › Controls › Fields).
export const fieldLabel = style({ marginBlockStart: '16px', fontSize: '14px', fontWeight: 600 })
/** A 52px stock field with a rule edge; an invalid one takes the invalid edge. */
export const textField = style({
  inlineSize: '100%',
  minBlockSize: '52px',
  paddingInline: '16px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'field',
  backgroundColor: 'stock',
  color: 'ink',
  fontSize: '16px',
  '&[aria-invalid="true"]': { borderColor: 'invalid' },
})
/** A text field for a few lines: the field's look with room above and below the words, and no resize grabber.
 * Combine with textField. */
export const textArea = style({ paddingBlock: '13px', lineHeight: 1.5, resize: 'none' })
export const formError = style({ marginBlockStart: '8px', fontSize: '14px', color: 'error' })
