import { keyframes } from 'zyzz/web'
import { cutoutGlow, style, vars } from '../zyzz.config.ts'

// Styles for a piece's pictures on its page, one swipe from the next (PieceCarouselView.ts).

/** A picture swiped or tapped to fades in where the last one was. */
const fadeIn = keyframes({ from: { opacity: 0, transform: 'scale(0.985)' } }, { id: 'styld-piece-slide-in' })

/** The picture, its dots and what it is under it. */
export const carousel = style({ display: 'grid', gap: 'actions', alignContent: 'start' })
/** The picture: a sideways swipe moves to the next, so the page keeps vertical scrolling and the press selects no
 * text. */
export const frame = style({
  position: 'relative',
  touchAction: 'pan-y',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
})
export const slide = style({
  animationName: fadeIn,
  animationDuration: vars.transitionDuration.hover,
  animationTimingFunction: vars.ease.standard,
})
/** A cut-out, a drawing or a back lies on the paper; in dark a dark garment keeps its edge (DESIGN.md › Dark). */
export const cutout = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'photo',
  '@media (min-width: 900px)': { aspectRatio: 'auto', blockSize: 'min(520px, 60vh)' },
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
})
/** The person's own photo shows its own backdrop, on stock behind its letterbox. */
export const photo = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'photo',
  backgroundColor: 'stock',
  '@media (min-width: 900px)': { aspectRatio: 'auto', blockSize: 'min(520px, 60vh)' },
})
/** The drawing's slide while it is being made: the square it will fill, saying so. */
export const making = style({
  display: 'grid',
  placeItems: 'center',
  alignContent: 'center',
  gap: 'actions',
  inlineSize: '100%',
  aspectRatio: '1 / 1',
  padding: '24px',
  borderRadius: 'photo',
  backgroundColor: 'paper2',
  color: 'ink2',
  textAlign: 'center',
  '@media (min-width: 900px)': { aspectRatio: 'auto', blockSize: 'min(520px, 60vh)' },
})
/** One dot a picture, the shown one drawn long in ink: each a button tall enough to tap. */
export const dots = style({ display: 'flex', justifyContent: 'center', gap: 'tight' })
export const dot = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: '28px',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  cursor: 'pointer',
  touchAction: 'manipulation',
  '&::after': {
    content: '""',
    inlineSize: '8px',
    blockSize: '8px',
    borderRadius: 'pill',
    backgroundColor: 'rule',
    transitionProperty: 'inline-size, background-color',
    transitionDuration: 'hover',
    transitionTimingFunction: 'standard',
  },
  '&[aria-current="true"]::after': { inlineSize: '20px', backgroundColor: 'ink' },
})
/** What the shown picture is, and making it the main one at the row's end. */
export const caption = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'actions',
  minBlockSize: '44px',
})
export const name = style({ display: 'grid', gap: 'hairline' })
export const title = style({ fontSize: 'label', fontWeight: 600 })
export const note = style({ fontSize: 'small', color: 'ink2' })
