import { global } from 'zyzz/web'
import { vars } from './zyzz.config.ts'

// Document defaults. Component styles live beside the views that use them.
global({
  ':root': {
    colorScheme: 'light',
    fontFamily: vars.fontFamily.body,
    backgroundColor: vars.color.paper,
    color: vars.color.ink,
    lineHeight: 1.55,
    fontSynthesis: 'none',
  },
  '*': { boxSizing: 'border-box' },
  html: {
    WebkitTextSizeAdjust: '100%',
    WebkitTapHighlightColor: 'transparent',
    scrollbarGutter: 'stable',
  },
  body: { margin: '0' },
  'h1, h2, p': { margin: '0' },
  'h1, h2': {
    fontFamily: vars.fontFamily.display,
    fontWeight: 300,
    lineHeight: 1.12,
    textWrap: 'balance',
  },
  h1: { fontSize: 'clamp(2.5rem, 1.5rem + 4vw, 5rem)', letterSpacing: '-0.022em', maxInlineSize: '15ch' },
  h2: { fontSize: '2rem' },
  p: { maxInlineSize: '65ch', textWrap: 'pretty' },
  a: { color: 'inherit', textUnderlineOffset: '0.2em', touchAction: 'manipulation' },
  'button, select, input': { font: 'inherit', fontSize: '1rem', touchAction: 'manipulation' },
  // DESIGN.md: every control keeps at least a 44px touch target.
  'button, select': { minBlockSize: '44px' },
  ':focus-visible': {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: vars.color.focus,
    outlineOffset: '4px',
  },
  '@media (hover: hover) and (pointer: fine)': { 'a:hover': { textDecorationThickness: '2px' } },
})
