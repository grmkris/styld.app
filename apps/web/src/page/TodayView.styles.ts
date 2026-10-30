import { keyframes } from 'zyzz/web'
import { style } from '../zyzz.config.ts'

// Home's table (Gallery 2: docs/design/gallery-2/site/v2/home.html).

/** A piece Spin brings in drops onto the table with a little bounce, one after another. */
const dropIn = keyframes(
  { from: { opacity: 0, transform: 'translateY(-8%) rotate(-6deg) scale(0.92)' } },
  { id: 'styld-today-drop-in' },
)

export const page = style({
  display: 'grid',
  gap: '28px',
  paddingBlock: '4px 40px',
  '@media (min-width: 900px)': {
    gridTemplateColumns: 'minmax(0, 560px) minmax(0, 1fr)',
    alignItems: 'start',
    columnGap: '48px',
  },
})
export const today = style({
  display: 'grid',
  gap: '12px',
  '@media (min-width: 900px)': { maxInlineSize: '560px' },
})
/** The table's headline: the day in the logo's condensed voice, its one use on a page. */
export const headline = style({
  margin: '0',
  fontFamily: 'voice',
  fontSize: 'clamp(52px, 40px + 4vw, 76px)',
  fontWeight: 400,
  lineHeight: 0.95,
  letterSpacing: '0.005em',
})
/** Wraps the still table: its pieces drop in one after another. */
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
  boxShadow: 'inset 0 0 0 1px #ddd6cc !custom',
  textAlign: 'center',
  color: 'ink2',
})
export const placeholderBody = style({ display: 'grid', justifyItems: 'center', gap: '12px' })
export const actions = style({ display: 'flex', alignItems: 'center', gap: '8px' })
export const wear = style({ flexGrow: 1 })
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
export const cards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
  gap: '12px',
})
export const card = style({
  display: 'grid',
  alignContent: 'start',
  gap: '8px',
  padding: '12px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink',
  textDecorationLine: 'none',
  boxShadow: '0 1px 2px oklch(0 0 0 / 0.05), 0 8px 24px oklch(0 0 0 / 0.05) !custom',
})
export const cardTitle = style({ fontWeight: 600 })
export const cardAction = style({ fontSize: '14px', fontWeight: 600, color: 'ink2' })
