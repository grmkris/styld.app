import { global } from 'zyzz/web'
import { vars } from './zyzz.config.ts'

// Document defaults (DESIGN.md › Type). Component styles live beside the views that use them.
global({
  ':root': {
    colorScheme: 'light',
    fontFamily: vars.fontFamily.body,
    fontSize: '16px',
    backgroundColor: vars.color.paper,
    color: vars.color.ink,
    lineHeight: 1.5,
    fontSynthesis: 'none',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
  },
  '*': { boxSizing: 'border-box' },
  html: {
    WebkitTextSizeAdjust: '100%',
    WebkitTapHighlightColor: 'transparent',
    scrollbarGutter: 'stable',
    overflowX: 'clip',
    // A focused field scrolls clear of the phone's tab bar instead of under it.
    '@media (max-width: 899px)': { scrollPaddingBlockEnd: 'calc(88px + env(safe-area-inset-bottom))' },
  },
  body: { margin: '0' },
  'h1, h2, h3, p, dl, dd': { margin: '0' },
  'h1, h2, h3': { textWrap: 'balance', overflowWrap: 'break-word', minInlineSize: '0' },
  h1: { fontSize: '30px', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.02em' },
  h2: { fontSize: '22px', lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em' },
  h3: { fontSize: '17px', lineHeight: 1.3, fontWeight: 600 },
  p: { maxInlineSize: '65ch', textWrap: 'pretty' },
  // A text link: semibold ink over a signal underline. Links styled as buttons drop it.
  a: {
    color: 'inherit',
    fontWeight: 600,
    textDecorationLine: 'underline',
    textDecorationColor: vars.color.signal,
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '4px',
    touchAction: 'manipulation',
  },
  'button, select, input': { font: 'inherit', fontSize: '1rem', color: 'inherit', touchAction: 'manipulation' },
  // DESIGN.md: every control keeps at least a 44px touch target.
  'button, select': { minBlockSize: '44px' },
  // Foldkit UI hides a file input behind its label with this class name.
  '.sr-only': {
    position: 'absolute',
    inlineSize: '1px',
    blockSize: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
  textarea: { font: 'inherit', fontSize: '1rem', color: 'inherit' },
  ':focus-visible': {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: vars.color.focus,
    outlineOffset: '2px',
  },
  // DESIGN.md › Motion: under reduced motion everything ends at once; loaders keep turning.
  '@media (prefers-reduced-motion: reduce)': {
    '*:not([data-loader]), ::before, ::after': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      transitionDuration: '0.01ms !important',
      scrollBehavior: 'auto !important',
    },
  },
})
