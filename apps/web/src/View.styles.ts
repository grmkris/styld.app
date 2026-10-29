import { style } from './zyzz.config.ts'

// Styles for the site frame, top bar, landing and footer in View.ts (Gallery: docs/design/gallery).
export const site = style({
  maxInlineSize: '78rem',
  marginInline: 'auto',
  paddingInline: 'max(20px, env(safe-area-inset-left), env(safe-area-inset-right))',
})
export const masthead = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px 16px',
  minBlockSize: '64px',
  paddingBlock: 'calc(12px + env(safe-area-inset-top)) 4px',
})
export const brand = style({ display: 'inline-flex', alignItems: 'center', minBlockSize: '44px' })
export const brandMark = style({ display: 'block', blockSize: '20px', inlineSize: 'auto' })
export const picker = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px',
  marginInlineStart: 'auto',
  fontSize: '14px',
  color: 'ink2',
})
// The picker's label stays for assistive technology; the select itself says which language is on.
export const visuallyHidden = style({
  position: 'absolute',
  inlineSize: '1px',
  blockSize: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
})
export const pickerSelect = style({
  minBlockSize: '44px',
  maxInlineSize: '11rem',
  paddingInline: '14px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
})
export const pickerError = style({ flexBasis: '100%' })
/** The top bar's sign-in text link. */
export const signInLink = style({ display: 'inline-flex', alignItems: 'center', minBlockSize: '44px' })
/** The top bar's account link: the person's initial in an ink circle (Gallery `.av`). */
export const accountLink = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  fontSize: '14px',
  fontWeight: 700,
  textDecorationLine: 'none',
})
export const intro = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: '16px',
  paddingBlock: 'clamp(24px, 8vw, 96px) clamp(40px, 8vw, 96px)',
})
/** The landing statement: Gallery's display size, the one heavy head on a page. */
export const heroTitle = style({
  maxInlineSize: '14ch',
  fontSize: 'clamp(46px, 34px + 3vw, 72px)',
  lineHeight: 1,
  fontWeight: 700,
  letterSpacing: '-0.035em',
})
export const lead = style({ maxInlineSize: '32ch', paddingBlockEnd: '8px', fontSize: '17px', color: 'ink2' })
export const heroActions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' })
export const inspiration = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  paddingBlock: '40px 80px',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
  scrollMarginBlockStart: '24px',
})
export const sectionNote = style({ color: 'ink2' })
export const emptyState = style({ paddingBlock: '24px', color: 'ink2' })
export const footer = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px 24px',
  paddingBlock: '24px calc(24px + env(safe-area-inset-bottom))',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
  fontSize: '14px',
  color: 'ink2',
})
export const footerLink = style({ display: 'inline-flex', alignItems: 'center', minBlockSize: '44px' })
// A footer control that reads like the contact link beside it.
export const footerButton = style({
  marginInlineStart: 'auto',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  color: 'inherit !custom',
  fontSize: '14px',
  fontWeight: 600,
  textDecorationLine: 'underline',
  textDecorationColor: 'signal',
  textDecorationThickness: '1.5px',
  textUnderlineOffset: '4px',
  cursor: 'pointer',
})
/** The diagnostics prompt as a Gallery sheet: card stock rising from the bottom edge, above a page's
 * own sticky action until the visitor answers. */
export const consentBanner = style({
  position: 'sticky',
  insetBlockEnd: '0',
  zIndex: 5,
  display: 'grid',
  gap: '16px',
  marginInline: 'calc(-1 * max(20px, env(safe-area-inset-left), env(safe-area-inset-right)))',
  paddingBlock: '20px calc(24px + env(safe-area-inset-bottom))',
  paddingInline: 'max(20px, env(safe-area-inset-left), env(safe-area-inset-right))',
  borderStartStartRadius: 'sheet',
  borderStartEndRadius: 'sheet',
  backgroundColor: 'stock',
  boxShadow: '0 -8px 32px oklch(0 0 0 / 0.14) !custom',
})
export const consentActions = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })

/** Room under the page for the phone's tab bar. */
export const withTabBar = style({
  paddingBlockEnd: 'calc(72px + env(safe-area-inset-bottom))',
  '@media (min-width: 900px)': { paddingBlockEnd: '0' },
})
/** The app's sections: a tab bar on the phone's bottom edge, text navigation in the desktop top bar. */
export const appNav = style({
  position: 'fixed',
  insetInline: '0',
  insetBlockEnd: '0',
  zIndex: 4,
  display: 'flex',
  justifyContent: 'space-around',
  paddingBlock: '8px calc(8px + env(safe-area-inset-bottom))',
  paddingInline: '4px',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
  backgroundColor: 'paper',
  '@media (min-width: 900px)': {
    position: 'static',
    justifyContent: 'flex-start',
    gap: '24px',
    padding: '0',
    borderBlockStartWidth: '0',
    backgroundColor: 'transparent !custom',
  },
})
export const navItem = style({
  display: 'grid',
  justifyItems: 'center',
  gap: '2px',
  minInlineSize: '64px',
  minBlockSize: '48px',
  paddingBlockStart: '4px',
  color: 'ink3',
  fontSize: '11px',
  fontWeight: 500,
  textDecorationLine: 'none',
  '&[aria-current="page"]': { color: 'ink', fontWeight: 700 },
  '@media (min-width: 900px)': {
    display: 'inline-flex',
    alignItems: 'center',
    minInlineSize: 'auto',
    minBlockSize: '44px',
    padding: '0',
    color: 'ink2',
    fontSize: '15px',
    '&[aria-current="page"]': {
      color: 'ink',
      fontWeight: 600,
      textDecorationLine: 'underline',
      textDecorationColor: 'ink',
      textDecorationThickness: '2px',
      textUnderlineOffset: '8px',
    },
  },
})
/** Tab icons belong to the phone's tab bar only. */
export const navIcon = style({ display: 'inline-flex', '@media (min-width: 900px)': { display: 'none' } })
/** The desktop top bar already carries the account initial. */
export const phoneOnly = style({ '@media (min-width: 900px)': { display: 'none' } })
export const navAvatar = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: '24px',
  blockSize: '24px',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  fontSize: '10px',
  fontWeight: 700,
})
