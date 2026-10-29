import { style } from '../zyzz.config.ts'

// Styles for the account page in AccountView.ts (Gallery: docs/design/gallery/site/s/account.html).
export const accountPage = style({
  maxInlineSize: '30rem',
  minBlockSize: '65svh',
  paddingBlock: 'clamp(24px, 6vw, 72px)',
})
export const identity = style({ display: 'flex', alignItems: 'center', gap: '16px', marginBlock: '24px' })
export const avatar = style({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: '60px',
  blockSize: '60px',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  fontSize: '22px',
  fontWeight: 700,
})
export const identityText = style({ display: 'grid', gap: '2px', minInlineSize: '0', overflowWrap: 'anywhere' })
export const identityName = style({ fontSize: '17px', fontWeight: 600 })
export const identityEmail = style({ fontSize: '14px', color: 'ink2' })
/** v1's pending line: the loader in the signal colour beside secondary text. */
export const pendingStatus = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  color: 'ink2',
  '& > svg': { color: 'signal' },
})
export const unavailable = style({ display: 'grid', justifyItems: 'start', gap: '16px' })
