export { chip, chipSkeleton, lede as note } from '../Controls.styles.ts'
import { pressThenHover, style } from '../zyzz.config.ts'
export { grab, scrim, sheet, sheetHead, sheetTitle } from './Sheet.styles.ts'

// Ask (Gallery 2: docs/design/gallery-2/site/v2/ask.html, `.askbar`): search your wardrobe, the stylist, the + sheet.

// One column no wider than the page: an `auto` column grew to the search field's own width once the clear
// button showed, and the page ran sideways on a phone.
export const page = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 'gutter',
  paddingBlock: '0 40px',
  // A search reads in one measure on a wide screen (Gallery `.dask`), the + near the words.
  // Centred, as Styld's chat one tap away is, so the column does not jump between them.
  '@media (min-width: 900px)': { maxInlineSize: '760px', marginInline: 'auto', inlineSize: '100%' },
})
/** The search pill: the field, then its quiet clear and + inside, like the prototype's. */
export const search = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'tight',
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
  fontSize: 'body',
  textOverflow: 'ellipsis',
  appearance: 'none',
  ':focus-visible': { outlineWidth: '0' },
  '&::placeholder': { color: 'ink3', textOverflow: 'ellipsis' },
  '&::-webkit-search-cancel-button': { appearance: 'none', display: 'none' },
})
/** A quiet 44px round inside the pill or the sheet (clear, add, close): the bar's round (PageBar.styles.ts) that
 * keeps its size in a row. Combine with round. */
export const quiet = style({ flex: 'none' })
export const clear = style({ color: 'ink2' })
/** Suggestions in one row of fixed height, so nothing below moves as they arrive; it scrolls sideways. */
/** A row of chips that scrolls, cut at the screen's edge rather than the gutter, so it reads as more to come. */
export const chips = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'actions',
  blockSize: '44px',
  marginInline: 'calc(-1 * max(20px, env(safe-area-inset-left)))',
  paddingInline: 'max(20px, env(safe-area-inset-left))',
  scrollPaddingInline: 'max(20px, env(safe-area-inset-left))',
  overflowX: 'auto',
  scrollbarWidth: 'none',
})
/** What belongs here when the wardrobe is empty, and the one way to fill it. */
export const empty = style({
  display: 'grid',
  justifyItems: 'start',
  gap: 'related',
  paddingBlock: '8px',
  color: 'ink2',
})
export const emptyTitle = style({ fontSize: 'subheading', fontWeight: 600, color: 'ink' })
export const section = style({ display: 'grid', gap: 'close' })
/** The results' head: what is searched, and how many were found. */
export const resultsHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'related',
  minBlockSize: '44px',
})
export const resultsTitle = style({ fontSize: 'subheading', fontWeight: 600 })
export const count = style({ fontSize: 'label', color: 'ink3', fontVariantNumeric: 'tabular-nums' })
export const results = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))',
  gap: 'grid',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
/** A piece found, as the wardrobe draws it (Gallery `.cut`): the cutout, its name centred under it in ink-2. */
export const result = style({
  display: 'grid',
  justifyItems: 'center',
  gap: 'snug',
  color: 'ink2',
  fontSize: 'small',
  fontWeight: 500,
  textDecorationLine: 'none',
  // It presses, and lifts under the pointer as it does in the wardrobe; the lift's translate composes with the press.
  transitionProperty: 'transform, translate',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { translate: '0 -2px' } },
})
/** A found piece's name on one line, cut with an ellipsis rather than wrapping under a narrow cutout. */
export const resultName = style({
  maxInlineSize: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
export const resultImage = style({ inlineSize: '100%', aspectRatio: '1 / 1', objectFit: 'contain' })
export const nothingFound = style({ display: 'grid', justifyItems: 'start', gap: 'related', color: 'ink2' })
export const stylist = style({
  display: 'grid',
  justifyItems: 'start',
  gap: 'related',
  padding: '20px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
/** One way in on the + sheet: a link or a button that look the same, its icon, its name and a hint under it. */
export const option = style({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  alignItems: 'center',
  columnGap: 'related',
  inlineSize: '100%',
  minBlockSize: '64px',
  padding: '8px 12px',
  borderWidth: '0',
  borderRadius: 'panel',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  fontSize: 'inherit !custom',
  fontWeight: 600,
  textAlign: 'start',
  textDecorationLine: 'none',
  cursor: 'pointer',
  transitionProperty: 'transform, background-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  // A way in that is already under way stays still.
  '&[aria-disabled="true"]': { cursor: 'progress' },
  '&[aria-disabled="true"]:active': { transform: 'none' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
export const optionProblem = style({ paddingInline: '12px', fontSize: 'label', color: 'error' })
export const optionIcon = style({
  display: 'grid',
  placeItems: 'center',
  gridRow: 'span 2',
  inlineSize: '44px',
  blockSize: '44px',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
})
export const optionHint = style({ fontSize: 'small', fontWeight: 400, color: 'ink2' })
