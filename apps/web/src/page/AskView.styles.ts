import { keyframes } from 'zyzz/web'
import { style } from '../zyzz.config.ts'

// Ask (Gallery 2: docs/design/gallery-2/site/v2/ask.html): search your wardrobe, the stylist, the + sheet.

const grow = keyframes(
  { from: { opacity: 0, transform: 'scale(0.94) translateY(-6px)' } },
  { id: 'styld-ask-sheet-grow' },
)

export const page = style({ display: 'grid', gap: '20px', paddingBlock: '8px 40px' })
export const bar = style({ display: 'flex', alignItems: 'center', gap: '8px' })
export const search = style({
  display: 'flex',
  flexGrow: 1,
  alignItems: 'center',
  gap: '10px',
  minBlockSize: '52px',
  paddingInline: '16px 6px',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  boxShadow: 'inset 0 0 0 1px #ddd6cc !custom',
  ':focus-within': { boxShadow: 'inset 0 0 0 1.5px #1c1410 !custom' },
})
export const searchInput = style({
  flexGrow: 1,
  minInlineSize: '0',
  minBlockSize: '44px',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  ':focus-visible': { outlineWidth: '0' },
})
export const clear = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: '40px',
  blockSize: '40px',
  minBlockSize: '40px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink2',
  cursor: 'pointer',
})
export const add = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: '52px',
  blockSize: '52px',
  flex: 'none',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'ink',
  color: 'onInk',
  cursor: 'pointer',
  transitionProperty: 'transform, rotate',
  transitionDuration: '240ms',
  transitionTimingFunction: 'var(--styld-spring)',
  ':active': { transform: 'scale(0.96)' },
  '&[aria-expanded="true"]': { rotate: '45deg' },
})
/** The + sheet grows out of its button, top right. */
export const sheet = style({
  display: 'grid',
  gap: '4px',
  padding: '8px',
  borderRadius: 'sheet',
  backgroundColor: 'stock',
  boxShadow: '0 2px 6px oklch(0 0 0 / 0.1), 0 20px 48px oklch(0 0 0 / 0.1) !custom',
  transformOrigin: 'top right',
  animationName: grow,
  animationDuration: '420ms',
  animationTimingFunction: 'var(--styld-spring)',
})
export const option = style({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  alignItems: 'center',
  gap: '2px 14px',
  minBlockSize: '56px',
  padding: '10px 12px',
  borderRadius: 'panel',
  color: 'ink',
  fontWeight: 600,
  textDecorationLine: 'none',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
export const optionIcon = style({
  gridRow: 'span 2',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '40px',
  blockSize: '40px',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
})
export const optionHint = style({ fontSize: '13px', fontWeight: 400, color: 'ink2' })
export const section = style({ display: 'grid', gap: '10px' })
export const chips = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
export const chip = style({
  minBlockSize: '36px',
  paddingInline: '14px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink2',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
})
export const results = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))',
  gap: '16px',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const result = style({
  display: 'grid',
  gap: '6px',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 500,
  textDecorationLine: 'none',
})
export const resultImage = style({ inlineSize: '100%', aspectRatio: '1 / 1', objectFit: 'contain' })
export const stylist = style({
  display: 'grid',
  gap: '8px',
  padding: '20px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
export const note = style({ color: 'ink2' })
export const count = style({ fontSize: '14px', color: 'ink3', fontVariantNumeric: 'tabular-nums' })
