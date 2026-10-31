import { keyframes } from 'zyzz/web'
import { style } from '../zyzz.config.ts'

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
  gap: '28px',
  paddingBlock: '0 40px',
  '@media (min-width: 900px)': {
    gridTemplateColumns: 'minmax(0, clamp(320px, (100svh - 280px) * 0.8, 560px)) minmax(0, 1fr)',
    alignItems: 'start',
    columnGap: '48px',
  },
})
export const today = style({
  display: 'grid',
  gap: '12px',
  '@media (min-width: 900px)': { maxInlineSize: 'clamp(320px, (100svh - 280px) * 0.8, 560px)' },
})
/** The table's headline: the day in the logo's condensed voice, its one use on a page. */
export const headline = style({
  margin: '0',
  // The line keeps its height before the day is known.
  minBlockSize: '0.95em',
  fontFamily: 'voice',
  fontSize: 'clamp(52px, 40px + 4vw, 76px)',
  fontWeight: 400,
  lineHeight: 0.95,
  letterSpacing: '0.005em',
})
/** Wraps the still table after a Spin: its new pieces drop in one after another. */
export const table = style({
  '& > * > *': {
    animationName: dropIn,
    animationDuration: '700ms',
    animationTimingFunction: 'var(--styld-spring-bounce)',
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
export const placeholderBody = style({ display: 'grid', justifyItems: 'center', gap: '12px' })
export const actions = style({ display: 'flex', alignItems: 'center', gap: '8px' })
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
  transitionProperty: 'transform, rotate',
  transitionDuration: '420ms',
  transitionTimingFunction: 'var(--styld-spring)',
  ':active': { transform: 'scale(0.96)' },
})
export const note = style({
  minBlockSize: '1.5em',
  fontSize: '14px',
  color: 'ink2',
  '&[data-tone="error"]': { color: 'error' },
})
/** What a whole outfit still needs, as small ways into adding pieces. */
export const missing = style({ display: 'flex', flexWrap: 'wrap', gap: '8px' })
export const missingLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  minBlockSize: '40px',
  paddingInline: '14px',
  borderRadius: 'pill',
  backgroundColor: 'paper2',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 600,
  textDecorationLine: 'none',
  transitionProperty: 'transform',
  transitionDuration: '160ms',
  transitionTimingFunction: 'ease-out',
  ':active': { transform: 'scale(0.96)' },
})
export const pickUp = style({
  display: 'grid',
  gap: '12px',
  '@media (min-width: 900px)': { paddingBlockStart: '96px' },
})
/** Two ways to pick up side by side, as tall as each other, each with its action at its foot. */
export const cards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  alignItems: 'stretch',
  gap: '12px',
})
/** The prototype's `.rc`: a stock card with what it is, then its action. */
export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  minInlineSize: '0',
  padding: '12px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink',
  boxShadow: 'lift1',
})
export const cardTitle = style({ margin: '0', fontWeight: 600, overflowWrap: 'anywhere' })
/** The card's action: a soft full-width pill at its foot. A long label wraps rather than leaving the pill. */
export const cardAction = style({
  inlineSize: '100%',
  marginBlockStart: 'auto',
  paddingInline: '12px',
  paddingBlock: '8px',
  whiteSpace: 'normal',
  textAlign: 'center',
  textWrap: 'balance',
})
/** A board on its card: its table cropped to 16:10 around what lies on it (`--crop`, set by the browser, is the share
 * of the table above the window), with corners concentric with the card's: 16px less its 12px padding. Inside the
 * window the table's corners are square, so the window can reach its top and its foot without showing them round.
 * The table is found by its `data-paper`, which outranks the paper's own radius whatever order the styles load in. */
/** The tray card's pictures: up to three found pieces on paper, in the board card's 16:10 window. */
export const trayThumbs = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '6px',
  aspectRatio: '16 / 10',
  marginBlockEnd: '4px',
  padding: '8px',
  borderRadius: 'photo',
  backgroundColor: 'paper',
  boxShadow: 'edge',
  isolation: 'isolate',
})
export const trayThumb = style({
  inlineSize: '100%',
  blockSize: '100%',
  minBlockSize: '0',
  objectFit: 'contain',
  mixBlendMode: 'darken',
})
export const boardCrop = style({
  position: 'relative',
  display: 'grid',
  aspectRatio: '16 / 10',
  marginBlockEnd: '4px',
  overflow: 'hidden',
  borderRadius: 'photo',
  '& > [data-paper]': { translate: '0 calc(var(--crop) * -100%)', borderRadius: '0 !custom' },
  '::after': {
    content: '""',
    position: 'absolute',
    inset: '0',
    borderRadius: 'photo',
    boxShadow: 'edge',
    pointerEvents: 'none',
  },
})
export const explore = style({ display: 'inline-flex', alignItems: 'center', minBlockSize: '44px', fontWeight: 600 })
