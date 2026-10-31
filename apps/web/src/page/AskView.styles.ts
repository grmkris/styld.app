import { keyframes } from 'zyzz/web'
import { style } from '../zyzz.config.ts'

// Ask (Gallery 2: docs/design/gallery-2/site/v2/ask.html, `.askbar`): search your wardrobe, the stylist, the + sheet.

const rise = keyframes({ from: { transform: 'translateY(100%)' } }, { id: 'styld-ask-sheet-rise' })
const fade = keyframes({ from: { opacity: 0 } }, { id: 'styld-ask-scrim-fade' })

// One column no wider than the page: an `auto` column grew to the search field's own width once the clear
// button showed, and the page ran sideways on a phone.
export const page = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: '20px',
  paddingBlock: '0 40px',
  // A search reads in one measure on a wide screen (Gallery `.dask`), the + near the words.
  '@media (min-width: 900px)': { maxInlineSize: '760px' },
})
/** The search pill: the field, then its quiet clear and + inside, like the prototype's. */
export const search = style({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  minInlineSize: '0',
  minBlockSize: '52px',
  paddingBlock: '4px',
  paddingInline: '16px 4px',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  boxShadow: 'edge',
  color: 'ink2',
  ':focus-within': { boxShadow: 'chosen' },
})
export const searchInput = style({
  flexGrow: 1,
  minInlineSize: '0',
  minBlockSize: '44px',
  paddingInlineStart: '6px',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  // 16px keeps iPhone Safari from zooming into the field.
  fontSize: '16px',
  textOverflow: 'ellipsis',
  appearance: 'none',
  ':focus-visible': { outlineWidth: '0' },
  '&::placeholder': { color: 'ink3', textOverflow: 'ellipsis' },
  '&::-webkit-search-cancel-button': { appearance: 'none', display: 'none' },
})
/** A quiet 44px round inside the pill or the sheet: clear, add, close. */
export const quiet = style({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: '44px',
  blockSize: '44px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
export const clear = style({ color: 'ink2' })
/** Suggestions in one row of fixed height, so nothing below moves as they arrive; it scrolls sideways. */
/** A row of chips that scrolls, cut at the screen's edge rather than the gutter, so it reads as more to come. */
export const chips = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  blockSize: '44px',
  marginInline: 'calc(-1 * max(20px, env(safe-area-inset-left)))',
  paddingInline: 'max(20px, env(safe-area-inset-left))',
  scrollPaddingInline: 'max(20px, env(safe-area-inset-left))',
  overflowX: 'auto',
  scrollbarWidth: 'none',
})
export const chip = style({
  position: 'relative',
  flex: 'none',
  minBlockSize: '36px',
  paddingInline: '14px',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink2',
  fontSize: '14px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  ':active': { transform: 'scale(0.96)' },
  // A 36px pill with a 44px target (DESIGN.md › Controls).
  '::after': { content: '""', position: 'absolute', insetInline: '0', insetBlock: '-4px' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2Hover' } },
})
export const chipSkeleton = style({ flex: 'none', inlineSize: '72px', blockSize: '36px', borderRadius: 'pill' })
/** What belongs here when the wardrobe is empty, and the one way to fill it. */
export const empty = style({ display: 'grid', justifyItems: 'start', gap: '12px', paddingBlock: '8px', color: 'ink2' })
export const emptyTitle = style({ fontSize: '17px', fontWeight: 600, color: 'ink' })
export const section = style({ display: 'grid', gap: '10px' })
/** The results' head: what is searched, and how many were found. */
export const resultsHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  minBlockSize: '44px',
})
export const resultsTitle = style({ fontSize: '17px', fontWeight: 600 })
export const count = style({ fontSize: '14px', color: 'ink3', fontVariantNumeric: 'tabular-nums' })
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
export const nothingFound = style({ display: 'grid', justifyItems: 'start', gap: '12px', color: 'ink2' })
export const stylist = style({
  display: 'grid',
  justifyItems: 'start',
  gap: '12px',
  padding: '20px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
export const note = style({ color: 'ink2' })
/** The + sheet rises from the bottom edge over a scrim (DESIGN.md › Surfaces). */
export const scrim = style({
  position: 'fixed',
  inset: '0',
  backgroundColor: 'scrim',
  animationName: fade,
  animationDuration: '200ms',
  animationTimingFunction: 'ease-out',
})
export const sheet = style({
  position: 'fixed',
  insetInline: '0',
  insetBlockEnd: '0',
  marginInline: 'auto',
  maxInlineSize: '32rem',
  display: 'grid',
  gap: '4px',
  paddingInline: '8px',
  paddingBlock: '8px calc(16px + env(safe-area-inset-bottom))',
  borderStartStartRadius: 'sheet',
  borderStartEndRadius: 'sheet',
  backgroundColor: 'stock',
  boxShadow: 'sheet',
  animationName: rise,
  animationDuration: '420ms',
  animationTimingFunction: 'var(--styld-spring)',
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
export const sheetTitle = style({ fontSize: '17px', fontWeight: 600 })
export const option = style({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  alignItems: 'center',
  columnGap: '12px',
  minBlockSize: '64px',
  padding: '8px 12px',
  borderRadius: 'panel',
  color: 'ink',
  fontWeight: 600,
  textDecorationLine: 'none',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
export const optionIcon = style({
  display: 'grid',
  placeItems: 'center',
  gridRow: 'span 2',
  inlineSize: '44px',
  blockSize: '44px',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
})
export const optionHint = style({ fontSize: '13px', fontWeight: 400, color: 'ink2' })
