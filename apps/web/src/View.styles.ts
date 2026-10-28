import { style } from './zyzz.config.ts'

// Styles for the site frame, masthead and landing views in View.ts.
export const site = style({
  maxInlineSize: '78rem',
  marginInline: 'auto',
  paddingInline: 'max(1.25rem, env(safe-area-inset-left), env(safe-area-inset-right))',
})
export const masthead = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '1.5rem',
  paddingBlock: 'calc(1rem + env(safe-area-inset-top)) 1rem',
})
export const brand = style({ display: 'inline-flex' })
export const brandMark = style({ display: 'block' })
export const picker = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.6rem',
  marginInlineStart: 'auto',
})
export const pickerSelect = style({
  minBlockSize: '44px',
  maxInlineSize: '100%',
  padding: '0.45rem',
  backgroundColor: 'transparent !custom',
  color: 'inherit !custom',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'muted',
  borderRadius: 'control',
})
export const pickerError = style({ flexBasis: '100%' })
export const intro = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: '1.5rem',
  paddingBlock: 'clamp(3rem, 10vw, 8rem)',
})
export const lead = style({ fontSize: '1.2rem', maxInlineSize: '45ch', color: 'muted' })
export const inspiration = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  paddingBlock: '2rem 5rem',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
  scrollMarginBlockStart: '2rem',
})
export const emptyState = style({ paddingBlock: '2rem', color: 'muted' })
export const footer = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1rem',
  paddingBlock: '1.5rem calc(1.5rem + env(safe-area-inset-bottom))',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
export const footerLink = style({ marginInlineStart: 'auto', minBlockSize: '44px' })
