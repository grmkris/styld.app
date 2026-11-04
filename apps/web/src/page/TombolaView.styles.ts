import { keyframes } from 'zyzz/web'
import { cutoutGlow, style, vars } from '../zyzz.config.ts'

// What to wear today: the button under the day, and the screen it opens. The wheel turns several times round and
// slows onto the drawn piece at its top (`--land`, set in the browser); the piece then grows into the middle. Under
// reduced motion both end at once (GlobalStyles).

const turn = keyframes({ from: { rotate: '0deg' }, to: { rotate: 'var(--land)' } }, { id: 'styld-tombola-turn' })
const grow = keyframes({ from: { opacity: 0, transform: 'scale(0.7)' } }, { id: 'styld-tombola-grow' })

/** The button's place under the day: as wide as the page on a phone. */
export const slotBox = style({ display: 'grid', minInlineSize: '0' })
export const button = style({ inlineSize: '100%', gap: 'actions' })
export const buttonSkeleton = style({ blockSize: '48px', borderRadius: 'pill' })

/** The screen over the whole page, the scrollbar's gutter too. */
export const screen = style({
  display: 'grid',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  inlineSize: '100vw',
  blockSize: '100dvh',
  maxInlineSize: 'none',
  maxBlockSize: 'none',
  margin: '0',
  paddingBlock: 'calc(0px + env(safe-area-inset-top)) calc(0px + env(safe-area-inset-bottom))',
  paddingInline: 'max(0px, env(safe-area-inset-left), env(safe-area-inset-right))',
  borderStyle: 'none',
  backgroundColor: 'paper',
  color: 'ink',
  overflow: 'hidden',
  overscrollBehavior: 'contain',
})
export const bar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'related',
  paddingBlock: '12px',
  paddingInline: '20px',
})
export const title = style({ margin: '0', fontSize: 'heading', fontWeight: 600 })
export const stage = style({
  display: 'grid',
  placeItems: 'center',
  alignContent: 'center',
  gap: 'section',
  minBlockSize: '0',
  paddingInline: '20px',
  paddingBlockEnd: '24px',
  overflowY: 'auto',
})
export const status = style({ margin: '0', color: 'ink2' })

/** The wheel: a ring of the person's pieces on paper, under a mark at its top where the drawn one stops. */
export const wheelBox = style({
  position: 'relative',
  inlineSize: 'min(84vw, 380px)',
  aspectRatio: '1 / 1',
  '::before': {
    content: '""',
    position: 'absolute',
    insetBlockStart: '-14px',
    insetInlineStart: 'calc(50% - 9px)',
    inlineSize: '18px',
    blockSize: '14px',
    clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
    backgroundColor: 'ink',
    zIndex: 1,
  },
})
export const wheel = style({
  position: 'relative',
  inlineSize: '100%',
  blockSize: '100%',
  containerType: 'size',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  boxShadow: 'lift1',
  animationName: turn,
  animationDuration: vars.transitionDuration.wheel,
  animationTimingFunction: vars.ease.wheel,
  animationFillMode: 'forwards',
})
/** A piece's place on the wheel: `--slot` of twelve, a twelfth of a turn apart, its top towards the rim. */
export const slot = style({
  position: 'absolute',
  insetBlockStart: '50%',
  insetInlineStart: '50%',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '22cqw',
  aspectRatio: '1 / 1',
  translate: '-50% -50%',
  transform: 'rotate(calc(var(--slot) * 30deg)) translateY(-37cqw)',
})
export const slotPicture = style({
  inlineSize: '100%',
  blockSize: '100%',
  objectFit: 'contain',
  mixBlendMode: 'darken',
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
})

/** The drawn piece, large in the middle, then what it is and the ways on. */
export const result = style({
  display: 'grid',
  justifyItems: 'center',
  gap: 'related',
  inlineSize: 'min(100%, 420px)',
  animationName: grow,
  animationDuration: vars.transitionDuration.spring,
  animationTimingFunction: vars.ease.springBounce,
  animationFillMode: 'both',
})
export const resultPicture = style({
  inlineSize: 'min(70vw, 300px)',
  aspectRatio: '4 / 5',
  objectFit: 'contain',
  mixBlendMode: 'darken',
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
})
export const resultTitle = style({ margin: '0', fontSize: 'subheading', fontWeight: 600, textAlign: 'center' })
export const actions = style({ display: 'grid', gap: 'actions', inlineSize: '100%' })
/** Wear it today and Build my own, side by side under Make outfits with it. */
export const pair = style({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'actions' })
export const links = style({ display: 'flex', justifyContent: 'center', gap: 'section' })
export const problem = style({ margin: '0', fontSize: 'small', color: 'error' })
