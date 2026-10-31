import { style } from '../zyzz.config.ts'

// Styles for the account page in AccountView.ts (Gallery: docs/design/gallery/site/s/account.html).
export const accountPage = style({
  maxInlineSize: '30rem',
  paddingBlock: '0 40px',
})
export const identity = style({ display: 'flex', alignItems: 'center', gap: '16px', marginBlock: '24px' })
export const identityText = style({ display: 'grid', gap: '2px', minInlineSize: '0', overflowWrap: 'anywhere' })
export const identityName = style({ fontSize: '17px', fontWeight: 600 })
export const identityEmail = style({ fontSize: '14px', color: 'ink2' })
/** The identity box while the session or the profile is read: the large avatar's circle, the name's line, the email's. */
export const avatarSkeleton = style({ flex: 'none', inlineSize: '72px', blockSize: '72px', borderRadius: 'pill' })
export const nameSkeleton = style({ inlineSize: '9em', fontSize: '17px' })
export const emailSkeleton = style({ inlineSize: '14em', fontSize: '14px' })
/** A section other pages link to: it lands a little below the top of the screen. */
export const linkedSection = style({ scrollMarginBlockStart: '16px' })
export const unavailable = style({ display: 'grid', justifyItems: 'start', gap: '16px' })
export const section = style({
  display: 'grid',
  gap: '12px',
  paddingBlock: '20px',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
/** Deleting the account: a text action in the error colour, underlined in it. */
export const deleteAccount = style({ justifySelf: 'start', color: 'error', textDecorationColor: 'error' })
export const sectionTitle = style({ fontSize: '17px', fontWeight: 600, margin: '0' })
/** The profile's status line while it is read. */
export const statusSkeleton = style({ inlineSize: '14em', fontSize: '15px' })
export const sectionText = style({ fontSize: '15px', color: 'ink2', margin: '0', lineHeight: 1.5 })
export const steps = style({
  display: 'grid',
  gap: '6px',
  margin: '0',
  paddingInlineStart: '20px',
  fontSize: '14px',
  color: 'ink2',
})
export const hostName = style({ fontSize: '14px', fontWeight: 600, margin: '0' })
/** The server address: selectable text on stock, so it can be copied by hand too. */
export const serverUrl = style({
  display: 'block',
  padding: '12px 14px',
  borderRadius: 'field',
  backgroundColor: 'stock',
  fontFamily: 'body',
  fontSize: '14px',
  fontVariantNumeric: 'tabular-nums',
  overflowWrap: 'anywhere',
  userSelect: 'all',
})
export const rowActions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' })
export const notice = style({ fontSize: '14px', color: 'ink2', margin: '0' })
export const problem = style({ fontSize: '14px', color: 'error', margin: '0' })
