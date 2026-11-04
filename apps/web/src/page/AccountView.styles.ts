import { style } from '../zyzz.config.ts'

// Styles for the account page in AccountView.ts (Gallery: docs/design/gallery/site/s/account.html).
export const accountPage = style({
  maxInlineSize: '30rem',
  paddingBlock: '0 40px',
})
export const identity = style({ display: 'flex', alignItems: 'center', gap: 'grid', marginBlock: '24px' })
export const identityText = style({ display: 'grid', gap: 'hairline', minInlineSize: '0', overflowWrap: 'anywhere' })
export const identityName = style({ fontSize: 'subheading', fontWeight: 600 })
export const identityEmail = style({ fontSize: 'label', color: 'ink2' })
/** The identity box while the session or the profile is read: the large avatar's circle, the name's line, the email's. */
export const avatarSkeleton = style({ flex: 'none', inlineSize: '72px', blockSize: '72px', borderRadius: 'pill' })
export const nameSkeleton = style({ inlineSize: '9em', fontSize: 'subheading' })
export const emailSkeleton = style({ inlineSize: '14em', fontSize: 'label' })
/** A section other pages link to: it lands a little below the top of the screen. */
export const linkedSection = style({ scrollMarginBlockStart: '16px' })
export const unavailable = style({ display: 'grid', justifyItems: 'start', gap: 'grid' })
export const section = style({
  display: 'grid',
  gap: 'related',
  paddingBlock: '20px',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
/** Deleting the account: a text action in the error colour, underlined in it. */
export const deleteAccount = style({ justifySelf: 'start', color: 'error', textDecorationColor: 'error' })
export const sectionTitle = style({ fontSize: 'subheading', fontWeight: 600, margin: '0' })
/** The profile's status line while it is read. */
export const statusSkeleton = style({ inlineSize: '14em', fontSize: 'control' })
export const sectionText = style({ fontSize: 'control', color: 'ink2', margin: '0', lineHeight: 1.5 })
export const steps = style({
  display: 'grid',
  gap: 'snug',
  margin: '0',
  paddingInlineStart: '20px',
  fontSize: 'label',
  color: 'ink2',
})
export const hostName = style({ fontSize: 'label', fontWeight: 600, margin: '0' })
/** The server address: selectable text on stock, so it can be copied by hand too. */
export const serverUrl = style({
  display: 'block',
  padding: '12px 14px',
  borderRadius: 'field',
  backgroundColor: 'stock',
  fontFamily: 'body',
  fontSize: 'label',
  fontVariantNumeric: 'tabular-nums',
  overflowWrap: 'anywhere',
  userSelect: 'all',
})
export const rowActions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'related' })
/** Signing out, under who they are and above the first section's rule. */
export const signOutRow = style({ marginBlockStart: '-8px', paddingBlockEnd: '24px' })
export const notice = style({ fontSize: 'label', color: 'ink2', margin: '0' })
export const problem = style({ fontSize: 'label', color: 'error', margin: '0' })
/** The plans: a plain list of name, price and Choose, one row each, the figures in tabular digits. */
export const planList = style({ display: 'grid', margin: '0' })
export const planRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(5.5em, auto) 1fr auto',
  alignItems: 'center',
  gap: 'related',
  paddingBlock: '8px',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
})
export const planName = style({ fontSize: 'control', fontWeight: 600, margin: '0' })
export const planPrice = style({ fontSize: 'label', color: 'ink2', margin: '0', fontVariantNumeric: 'tabular-nums' })
export const planAction = style({ margin: '0' })
