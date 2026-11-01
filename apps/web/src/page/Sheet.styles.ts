import { keyframes } from 'zyzz/web'
import { style, vars } from '../zyzz.config.ts'

// A sheet from the bottom edge (DESIGN.md › Surfaces), after Ask's + sheet: every sheet in the app draws through Sheet.ts
// with these.

const rise = keyframes({ from: { transform: 'translateY(100%)' } }, { id: 'styld-ask-sheet-rise' })
const fade = keyframes({ from: { opacity: 0 } }, { id: 'styld-ask-scrim-fade' })

/** The + sheet rises from the bottom edge over a scrim (DESIGN.md › Surfaces). */
export const scrim = style({
  position: 'fixed',
  inset: '0',
  backgroundColor: 'scrim',
  animationName: fade,
  animationDuration: vars.transitionDuration.brief,
  animationTimingFunction: vars.ease.out,
  // Leaving, the scrim fades with the sheet (an animated Dialog marks the leave).
  transitionProperty: 'opacity',
  transitionDuration: 'fade',
  transitionTimingFunction: 'out',
  '&[data-leave]': { opacity: 0 },
  '@media (prefers-reduced-motion: reduce)': { transitionDuration: 'instant' },
})
/** A sheet's body under its head: in line with the title at the 20px gutter, scrolling once it is taller than most of
 * the screen, so a phone held sideways still reaches the title and the close button. */
export const sheetBody = style({
  display: 'grid',
  gap: 'tight',
  maxBlockSize: '70dvh',
  overflowY: 'auto',
  paddingInline: '12px',
  paddingBlockEnd: '4px',
})
export const sheet = style({
  position: 'fixed',
  insetInline: '0',
  insetBlockEnd: '0',
  marginInline: 'auto',
  maxInlineSize: '32rem',
  display: 'grid',
  gap: 'tight',
  paddingInline: '8px',
  paddingBlock: '8px calc(16px + env(safe-area-inset-bottom))',
  borderStartStartRadius: 'sheet',
  borderStartEndRadius: 'sheet',
  backgroundColor: 'stock',
  boxShadow: 'sheet',
  animationName: rise,
  animationDuration: vars.transitionDuration.travel,
  animationTimingFunction: vars.ease.spring,
  // It rises on a spring and leaves softer than it came: a 16px drop and a fade (make-interfaces-feel-better › exits).
  transitionProperty: 'translate, opacity',
  transitionDuration: 'fade',
  transitionTimingFunction: 'out',
  '&[data-leave]': { translate: '0 16px', opacity: 0 },
  '@media (prefers-reduced-motion: reduce)': { transitionDuration: 'instant' },
})
export const grab = style({
  justifySelf: 'center',
  inlineSize: '40px',
  blockSize: '4px',
  marginBlock: '2px 4px',
  borderRadius: 'pill',
  backgroundColor: 'rule',
})
export const sheetHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingInlineStart: '12px',
})
export const sheetTitle = style({ fontSize: 'subheading', fontWeight: 600 })
