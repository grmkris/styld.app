import { style } from './zyzz.config.ts'

// Styles for the sign-in and account views in ViewAccount.ts (Gallery: docs/design/gallery/site/s/login.html).
export const authPage = style({ maxInlineSize: '30rem', minBlockSize: '65svh', paddingBlock: 'clamp(24px, 6vw, 72px)' })
export const authForm = style({ display: 'grid', gap: '8px', marginBlockStart: '24px' })
export const fieldLabel = style({ marginBlockStart: '16px', fontSize: '14px', fontWeight: 600 })
export const authInput = style({
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
  ':user-invalid': { borderColor: 'invalid' },
})
export const submit = style({ inlineSize: '100%', marginBlockStart: '24px' })
export const formError = style({ marginBlockStart: '8px', fontSize: '14px', color: 'error' })
/** v1's pending line: the loader in the signal colour beside secondary text. */
export const pendingStatus = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  color: 'ink2',
  '& > svg': { color: 'signal' },
})
export const accountDetails = style({ display: 'grid', justifyItems: 'start', gap: '24px', overflowWrap: 'anywhere' })
export const detailList = style({ display: 'grid', gap: '4px' })
export const detailTerm = style({ fontSize: '14px', color: 'ink2' })
export const detailValue = style({ margin: '0', marginBlockEnd: '12px', fontWeight: 500 })
