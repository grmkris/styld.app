import { style } from '../zyzz.config.ts'

// Styles for the sign-in page in LoginView.ts (Gallery: docs/design/gallery/site/s/login.html).
export const authPage = style({ maxInlineSize: '30rem', minBlockSize: '65svh', paddingBlock: 'clamp(24px, 6vw, 72px)' })
export const authForm = style({ display: 'grid', gap: 'actions', marginBlockStart: '16px' })
export const lede = style({ fontSize: 'subheading', color: 'ink2' })
export const emailShown = style({ color: 'ink', fontWeight: 600, overflowWrap: 'anywhere' })
export const submit = style({ inlineSize: '100%', marginBlockStart: '16px' })
export const notice = style({ marginBlockStart: '8px', fontSize: 'label', color: 'ink2' })
export const loginActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'actions',
  marginBlockStart: '16px',
})
/** A quiet text action beside a secondary one: semibold ink over the signal underline. */
export const linkButton = style({
  minBlockSize: '44px',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  fontWeight: 600,
  textDecorationLine: 'underline',
  textDecorationColor: 'signal',
  textDecorationThickness: '1.5px',
  textUnderlineOffset: '4px',
  cursor: 'pointer',
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
})

/** "or" between the code and Google, ruled on both sides (Gallery `.or`). */
export const orRule = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'related',
  marginBlockStart: '8px',
  fontSize: 'label',
  color: 'ink2',
  '&::before': { content: "''", flexGrow: 1, blockSize: '1px', backgroundColor: 'rule' },
  '&::after': { content: "''", flexGrow: 1, blockSize: '1px', backgroundColor: 'rule' },
})
