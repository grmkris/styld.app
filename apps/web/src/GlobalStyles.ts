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
    // Springs sampled into linear(): things that travel settle on these (DESIGN.md › Motion).
    '--styld-spring':
      'linear(0, 0.0357, 0.1183, 0.2215, 0.3294, 0.433, 0.5273, 0.6104, 0.6819, 0.7423, 0.7925, 0.8339, 0.8677, 0.895, 0.9171, 0.9347, 0.9487, 0.9598, 0.9686, 0.9755, 0.9809, 0.9852, 0.9885, 0.9911, 0.9931, 0.9947, 0.9959, 0.9968, 0.9976, 0.9981, 0.9986, 0.9989, 1)',
    '--styld-spring-bounce':
      'linear(0, 0.0491, 0.1629, 0.3039, 0.4479, 0.5806, 0.6949, 0.7883, 0.8613, 0.9159, 0.9549, 0.9815, 0.9985, 1.0085, 1.0134, 1.0151, 1.0147, 1.0132, 1.0111, 1.0089, 1.0068, 1.005, 1.0035, 1.0023, 1.0014, 1.0008, 1.0004, 1.0001, 0.9999, 0.9998, 0.9998, 0.9998, 1)',
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
  // The camera covers the page edge to edge: no scrollbar gutter beside it while it is open.
  'html:has(#camera-screen)': { scrollbarGutter: 'auto' },
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
