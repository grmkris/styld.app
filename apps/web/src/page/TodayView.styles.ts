import { keyframes } from 'zyzz/web'
import { style, vars } from '../zyzz.config.ts'

// Home's table (Gallery 2: docs/design/gallery-2/site/v2/home.html).

/** A piece Spin brings in drops onto the table with a little bounce, one after another. */
const dropIn = keyframes(
  { from: { opacity: 0, transform: 'translateY(-8%) rotate(-6deg) scale(0.92)' } },
  { id: 'styld-today-drop-in' },
)

/** On a desktop the table is as wide as lets it, Wear this and Spin fit the first screen under the bar and the
 * headline (about 280px), up to 560px; a short window still gets a 320px table. */
export const page = style({
  display: 'grid',
  gap: 'wide',
  paddingBlock: '0 40px',
  '@media (min-width: 900px)': {
    gridTemplateColumns: 'minmax(0, clamp(320px, (100svh - 280px) * 0.8, 560px)) minmax(0, 1fr)',
    alignItems: 'start',
    columnGap: 'columns',
  },
})
export const today = style({
  display: 'grid',
  gap: 'related',
  '@media (min-width: 900px)': { maxInlineSize: 'clamp(320px, (100svh - 280px) * 0.8, 560px)' },
})
/** The table's headline: the day in the logo's condensed voice, its one use on a page. */
export const headline = style({
  margin: '0',
  // The line keeps its height before the day is known.
  minBlockSize: '0.95em',
  fontFamily: 'voice',
  fontSize: 'headline',
  fontWeight: 400,
  lineHeight: 0.95,
  letterSpacing: '0.005em',
})
/** Wraps the still table after a Spin: its new pieces drop in one after another. */
export const table = style({
  '& > * > *': {
    animationName: dropIn,
    animationDuration: vars.transitionDuration.spring,
    animationTimingFunction: vars.ease.springBounce,
    animationFillMode: 'both',
  },
  '& > * > :nth-child(2)': { animationDelay: '40ms' },
  '& > * > :nth-child(3)': { animationDelay: '80ms' },
  '& > * > :nth-child(4)': { animationDelay: '120ms' },
  '& > * > :nth-child(5)': { animationDelay: '160ms' },
})
export const placeholder = style({
  display: 'grid',
  placeItems: 'center',
  aspectRatio: '4 / 5',
  padding: '24px',
  borderRadius: 'table',
  backgroundColor: 'paper',
  boxShadow: 'edge',
  textAlign: 'center',
  color: 'ink2',
})
export const placeholderBody = style({ display: 'grid', justifyItems: 'center', gap: 'related' })
export const actions = style({ display: 'flex', alignItems: 'center', gap: 'actions' })
export const wear = style({ flexGrow: 1 })
/** Wear this and Spin in outline while the pieces load: the same row, the same sizes. */
export const wearSkeleton = style({ flexGrow: 1, blockSize: '48px', borderRadius: 'pill' })
export const spinSkeleton = style({ flex: 'none', inlineSize: '48px', blockSize: '48px', borderRadius: 'pill' })
/** Worn today: done, not disabled. */
export const worn = style({
  flexGrow: 1,
  backgroundColor: 'tintSage',
  color: 'ink',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'tintSage' } },
})
export const spin = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: '48px',
  blockSize: '48px',
  flex: 'none',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink',
  cursor: 'pointer',
  // Press and colour at Gallery's 140ms; the springs stay on the pieces Spin brings in (DESIGN › Motion).
  transitionProperty: 'transform, background-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2Hover' } },
})
/** Swap one piece: a wrapping set of chips, one for each piece on the table. */
export const swaps = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
/** One swap chip's place in the set: never wider than the row. */
export const swapItem = style({ display: 'flex', minInlineSize: '0', maxInlineSize: '100%' })
/** A swap chip: its icon before the piece's name. */
export const swapChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'snug',
  minInlineSize: '0',
  '&[data-disabled]': { opacity: 0.5, cursor: 'not-allowed' },
})
/** A long piece name ends in an ellipsis rather than leaving the row; the chip's label still says it whole. */
export const swapName = style({ minInlineSize: '0', overflow: 'hidden', textOverflow: 'ellipsis' })
export const note = style({
  minBlockSize: '1.5em',
  fontSize: 'label',
  color: 'ink2',
  '&[data-tone="error"]': { color: 'error' },
})
/** What a whole outfit still needs, as small ways into adding pieces. */
export const missing = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
export const missingLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'snug',
  minBlockSize: '40px',
  paddingInline: '14px',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink',
  fontSize: 'label',
  fontWeight: 600,
  textDecorationLine: 'none',
  transitionProperty: 'transform, background-color',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2Hover' } },
})
