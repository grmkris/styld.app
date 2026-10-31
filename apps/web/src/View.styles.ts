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
  // The wordmark at the start, the way to you (or to sign in) at the end, as the prototype's `.head`.
  justifyContent: 'space-between',
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
  fontSize: '14px',
  color: 'ink2',
})
// The picker's label stays for assistive technology; the select itself says which language is on.
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
/** The top bar's text links when signed out: Explore and Sign in. */
export const signedOutLinks = style({ display: 'flex', alignItems: 'center', gap: '20px' })
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
/** The diagnostics prompt as a Gallery sheet: card stock rising from the bottom edge, above a page's own sticky
 * action and the navigation until the visitor answers, so its buttons are always the ones tapped. */
export const consentBanner = style({
  position: 'sticky',
  insetBlockEnd: '0',
  zIndex: 7,
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

/** Room for the navigation: under the page on the phone, beside it on the desktop. */
/** A tab page's main region reaches at least to the bottom of the screen, so the footer waits below the fold while
 * the page fills in. The top bar is 64px, or 60px under the status bar. Its rows keep their own heights rather than
 * stretching into the space. */
export const tabPage = style({
  '& > main': { minBlockSize: 'calc(100svh - max(64px, 60px + env(safe-area-inset-top)))', alignContent: 'start' },
})
/** The review tray's action band floats at the bottom, above the tab bar: the page ends past it, so the band never
 * covers the footer (ReviewView.styles.ts › footer). */
export const withActionBand = style({
  paddingBlockEnd: 'calc(180px + env(safe-area-inset-bottom))',
  '@media (min-width: 900px)': { paddingBlockEnd: '96px' },
})
export const withTabBar = style({
  paddingBlockEnd: 'calc(104px + env(safe-area-inset-bottom))',
  '@media (min-width: 900px)': { paddingBlockEnd: '0', paddingInlineStart: '112px' },
})
/** Gallery 2's navigation: a floating glass pill above the phone's bottom edge, a rail on the desktop's
 * left. Glass is allowed here and on the Ask panel only (DESIGN.md › Surfaces); it turns solid under
 * reduced transparency. */
export const appNav = style({
  position: 'fixed',
  insetBlockEnd: 'calc(16px + env(safe-area-inset-bottom))',
  insetInlineStart: '50%',
  zIndex: 6,
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '6px',
  borderRadius: 'pill',
  backgroundColor: 'glass',
  backdropFilter: 'blur(24px) saturate(160%)',
  WebkitBackdropFilter: 'blur(24px) saturate(160%)',
  boxShadow: 'inset 0 0 0 1px oklch(1 0 0 / 0.6), 0 2px 6px oklch(0 0 0 / 0.1), 0 20px 48px oklch(0 0 0 / 0.1) !custom',
  translate: '-50% 0',
  // Stays put while a tab change cross-fades the page under it (GlobalStyles.ts).
  viewTransitionName: 'styld-nav',
  '@media (min-width: 900px)': {
    insetBlockEnd: 'auto',
    insetBlockStart: '50%',
    insetInlineStart: '24px',
    flexDirection: 'column',
    translate: '0 -50%',
  },
  '@media (prefers-reduced-transparency: reduce)': {
    backgroundColor: 'stock',
    backdropFilter: 'none',
    WebkitBackdropFilter: 'none',
  },
})
/** The board editor has the whole phone screen, with its own way back to Boards: the pill would sit over its
 * tray of pieces. The desktop rail stays beside it. */
export const navBesideTable = style({ '@media (max-width: 899px)': { display: 'none' } })
export const navItem = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '52px',
  blockSize: '52px',
  borderRadius: 'pill',
  color: 'ink2',
  textDecorationLine: 'none',
  transitionProperty: 'transform, background-color, color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-current="page"]': { backgroundColor: 'paper2', color: 'ink' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { color: 'ink' } },
})
/** Ask, the one thing to do from anywhere: a filled ink circle in the middle. */
export const navAsk = style({
  inlineSize: '60px',
  blockSize: '60px',
  backgroundColor: 'ink',
  color: 'onInk',
  boxShadow: '0 4px 14px oklch(0 0 0 / 0.16) !custom',
  '&[aria-current="page"]': {
    backgroundColor: 'ink',
    color: 'onInk',
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'ink',
    outlineOffset: '3px',
  },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { color: 'onInk', backgroundColor: 'inkHover' } },
})
/** The visible label stays for assistive technology only; the icon carries the look (Gallery 2). */
export const navLabel = style({
  position: 'absolute',
  inlineSize: '1px',
  blockSize: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
})
/** The way to you: a 44px target around the 32px disc, with no text-link underline under the initial. */
export const navAvatar = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  marginInlineEnd: '-6px',
  borderRadius: 'pill',
  textDecorationLine: 'none',
})
export const navAvatarDisc = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: '32px',
  blockSize: '32px',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  fontSize: '13px',
  fontWeight: 700,
})
/** The avatar while the session is read: the same circle, blank until the initial is known. */
export const navAvatarPending = style({ backgroundColor: 'paper2' })
/** A board card's shape while the landing's boards load. */
export const boardSkeleton = style({ aspectRatio: '4 / 5', borderRadius: 'panel' })
/** The landing's boards keep their room while they load, so nothing below them moves when they arrive. */
export const inspirationGrid = style({ display: 'grid', gap: '12px', minBlockSize: '420px', alignContent: 'start' })
