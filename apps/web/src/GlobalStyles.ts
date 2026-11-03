import { fontFace, global } from 'zyzz/web'
import { vars } from './zyzz.config.ts'

// The logo's condensed voice (DESIGN.md › Type): the table's headline and headline labels on a board. The
// browser fetches a file only when a glyph of its range is drawn, so pages without it never load it.
fontFace({
  fontFamily: 'Anton',
  src: "url('/fonts/anton-latin.23aab0b2.woff2') format('woff2')",
  fontDisplay: 'swap',
  fontWeight: 400,
  unicodeRange:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
})
fontFace({
  fontFamily: 'Anton',
  src: "url('/fonts/anton-latin-ext.ae1a8ac1.woff2') format('woff2')",
  fontDisplay: 'swap',
  fontWeight: 400,
  unicodeRange:
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
})

// Hanken Grotesk's stand-in until the face arrives: the local Arial (Helvetica, Liberation Sans) resized to Hanken's
// width and given its ascent and descent, so lines break and sit where they will once it swaps in. Measured in
// Chromium on an English and Slovenian sample at 100px (Hanken 400: 9010 wide, ascent 100, descent 30; Arial 400:
// 8971; Hanken 600: 9064; Arial Bold: 9660). Semibold text falls back to Arial Bold, which runs wider.
fontFace({
  fontFamily: 'Hanken Grotesk Fallback',
  src: "local('Arial'), local('ArialMT'), local('Helvetica'), local('Liberation Sans')",
  fontWeight: '100 500',
  sizeAdjust: '100.44%',
  ascentOverride: '99.57%',
  descentOverride: '29.87%',
  lineGapOverride: '0%',
})
fontFace({
  fontFamily: 'Hanken Grotesk Fallback',
  src: "local('Arial Bold'), local('Arial-BoldMT'), local('Helvetica Bold'), local('Liberation Sans Bold')",
  fontWeight: '501 900',
  sizeAdjust: '93.83%',
  ascentOverride: '106.58%',
  descentOverride: '31.97%',
  lineGapOverride: '0%',
})

// Document defaults (DESIGN.md › Type). Component styles live beside the views that use them.
global({
  ':root': {
    // Light or dark as the device prefers (DESIGN.md › Dark): the colour tokens are `light-dark()` pairs, and the
    // browser's own controls follow. A page that offers dark is one a browser leaves alone; with `only light`, Samsung
    // Internet's dark mode still forced its own dark on Styld and sank the cut-outs into muddy tiles (Eva, 3 Nov).
    colorScheme: 'light dark',
    fontFamily: vars.fontFamily.body,
    fontSize: vars.fontSize.body,
    backgroundColor: vars.color.paper,
    color: vars.color.ink,
    lineHeight: 1.5,
    fontSynthesis: 'none',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    // Native checkboxes and radios take the ink, never the browser's blue (DESIGN.md › Signal: one accent).
    accentColor: vars.color.ink,
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
  // The camera covers the page edge to edge: no scrollbar gutter beside it while it is open.
  'html:has(#camera-screen)': { scrollbarGutter: 'auto' },
  body: { margin: '0' },
  'h1, h2, h3, p, dl, dd': { margin: '0' },
  'h1, h2, h3': { textWrap: 'balance', overflowWrap: 'break-word', minInlineSize: '0' },
  h1: { fontSize: vars.fontSize.title, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.02em' },
  h2: { fontSize: vars.fontSize.heading, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em' },
  h3: { fontSize: vars.fontSize.subheading, lineHeight: 1.3, fontWeight: 600 },
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
  'button, select, input': {
    font: 'inherit',
    fontSize: vars.fontSize.root,
    color: 'inherit',
    touchAction: 'manipulation',
  },
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
  textarea: { font: 'inherit', fontSize: vars.fontSize.root, color: 'inherit' },
  ':focus-visible': {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: vars.color.focus,
    outlineOffset: '2px',
  },
  // DESIGN.md › Motion: a tab change cross-fades the page while the navigation stays where it is. The runtime skips
  // the transition under reduced motion.
  '::view-transition-old(root), ::view-transition-new(root)': {
    animationDuration: vars.transitionDuration.hover,
    animationTimingFunction: vars.ease.standard,
  },
  '::view-transition-old(styld-nav)': { display: 'none' },
  '::view-transition-new(styld-nav)': { animationName: 'none' },
  // After a tab change the page's title takes focus for screen readers; a heading is not a control to ring.
  '#main h1:focus': { outlineWidth: '0' },
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
