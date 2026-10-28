import { style } from './zyzz.config.ts'

// Styles for the sign-in and account views in ViewAccount.ts.
export const authPage = style({ maxInlineSize: '32rem', minBlockSize: '65svh', paddingBlock: 'clamp(3rem, 8vw, 6rem)' })
export const authForm = style({ display: 'grid', gap: '0.65rem', marginBlockStart: '1.5rem' })
export const authInput = style({
  inlineSize: '100%',
  minBlockSize: '48px',
  padding: '0.65rem 0.8rem',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'control',
  backgroundColor: 'field',
  color: 'ink',
  ':user-invalid': { borderColor: 'invalid' },
})
export const submit = style({ justifySelf: 'start', marginBlockStart: '0.75rem' })
export const formError = style({ color: 'error' })
export const accountDetails = style({ display: 'grid', justifyItems: 'start', gap: '1.5rem', overflowWrap: 'anywhere' })
export const detailValue = style({ margin: '0', marginBlockEnd: '1rem' })
