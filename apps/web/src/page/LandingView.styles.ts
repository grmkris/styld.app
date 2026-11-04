import { keyframes } from 'zyzz/web'
import { style, vars } from '../zyzz.config.ts'

// The signed-out Home (LandingView.ts), owner's design of 4 November 2026: every screen is one full screen, its film
// (or the rail, or the chat) above, its words at the bottom; the titles in Anton, the wordmark's own face; and a short
// ending. A phone held upright gets the tall films; anything wider (`min-aspect-ratio: 4/5`, the films' own switch)
// the wide ones and the words at the bottom left.

/** The site frame on the landing: the screens run edge to edge, so the frame gives up its width and the bar and footer
 * keep theirs. */
export const site = style({
  maxInlineSize: 'none',
  paddingInline: '0',
  '& > header, & > footer': {
    maxInlineSize: '78rem',
    marginInline: 'auto',
    paddingInline: 'max(20px, env(safe-area-inset-left), env(safe-area-inset-right))',
  },
  // The bar lies over the hero's film, in the film's light ink.
  '& > header': { position: 'absolute', insetBlockStart: '0', insetInline: '0', zIndex: 2, color: 'swatchWhite' },
})

/** A screen: one screen tall (svh, so the address bar never resizes the film), its words at the bottom, clear of the
 * pinned Start free. */
export const screen = style({
  position: 'relative',
  display: 'grid',
  gridTemplateRows: '1fr auto',
  blockSize: '100svh',
  minBlockSize: '560px',
  overflow: 'hidden',
  paddingBlock: 'calc(56px + env(safe-area-inset-top)) calc(104px + env(safe-area-inset-bottom))',
  paddingInline: 'max(20px, env(safe-area-inset-left), env(safe-area-inset-right))',
  backgroundColor: 'paper2',
  color: 'swatchWhite',
  '@media (min-aspect-ratio: 4/5)': {
    paddingInline: 'max(clamp(24px, 5vw, 72px), env(safe-area-inset-left))',
    paddingBlockEnd: '56px',
  },
})
/** The hero: its statement at the top, Start free and Sign in at the bottom. */
export const hero = style({
  gridTemplateRows: 'auto 1fr',
  paddingBlock: 'calc(84px + env(safe-area-inset-top)) max(28px, env(safe-area-inset-bottom))',
  '@media (min-aspect-ratio: 4/5)': { paddingBlockEnd: '56px' },
})
/** The rail's and the chat's screens: on the page's own paper, in its ink. */
export const paperScreen = style({ backgroundColor: 'paper', color: 'ink' })

/** The poster and the film fill the screen; a shade under the words keeps them legible on any frame. */
export const film = style({
  position: 'absolute',
  inset: '0',
  margin: '0',
  '::after': {
    content: '""',
    position: 'absolute',
    inset: '0',
    backgroundImage:
      'linear-gradient(to bottom, transparent 42%, oklch(0.18 0.01 50 / 0.38) 62%, oklch(0.18 0.01 50 / 0.74))',
    pointerEvents: 'none',
  },
  '@media (min-aspect-ratio: 4/5)': {
    '::after': {
      backgroundImage:
        'linear-gradient(to right, oklch(0.18 0.01 50 / 0.7), oklch(0.18 0.01 50 / 0.2) 48%, transparent 70%), linear-gradient(to bottom, transparent 55%, oklch(0.18 0.01 50 / 0.45))',
    },
  },
})
/** The hero's shade is at the top, under its statement. */
export const heroFilm = style({
  '::after': {
    backgroundImage:
      'linear-gradient(to bottom, oklch(0.18 0.01 50 / 0.78), oklch(0.18 0.01 50 / 0.5) 34%, transparent 62%)',
  },
  '@media (min-aspect-ratio: 4/5)': {
    '::after': {
      backgroundImage:
        'linear-gradient(to right, oklch(0.18 0.01 50 / 0.62), oklch(0.18 0.01 50 / 0.15) 45%, transparent 65%)',
    },
  },
})
export const filmMedia = style({
  position: 'absolute',
  inset: '0',
  display: 'block',
  inlineSize: '100%',
  blockSize: '100%',
  objectFit: 'cover',
})

/** A screen's words: the title and one line, at the bottom; the hero's at the top. */
export const words = style({
  position: 'relative',
  zIndex: 2,
  gridRow: '2',
  alignSelf: 'end',
  display: 'grid',
  gap: 'cozy',
  maxInlineSize: '34rem',
})
export const heroWords = style({ gridRow: '1', alignSelf: 'start' })

/** A title in Anton, the wordmark's face, in sentence case: tall, condensed, set tight. Light words over a film keep a
 * soft dark edge, so they hold on a white shirt or a pale wall as well as on the shade. */
export const title = style({
  margin: '0',
  maxInlineSize: '12ch',
  fontFamily: 'voice',
  fontSize: 'display',
  fontWeight: 400,
  lineHeight: 0.98,
  letterSpacing: '0.004em',
  textWrap: 'balance',
  textShadow: '0 1px 1px oklch(0.18 0.01 50 / 0.5), 0 2px 18px oklch(0.18 0.01 50 / 0.45)',
})
export const line = style({
  margin: '0',
  maxInlineSize: '32ch',
  fontSize: 'subheading',
  lineHeight: 1.45,
  textWrap: 'pretty',
  textShadow: '0 1px 2px oklch(0.18 0.01 50 / 0.7), 0 0 14px oklch(0.18 0.01 50 / 0.5)',
  '@media (min-aspect-ratio: 4/5)': { maxInlineSize: '34ch' },
})
/** On paper the words are ink and need no edge. */
export const paperWords = style({ '& h2': { textShadow: 'none' }, '& p': { color: 'ink2', textShadow: 'none' } })

/** Start free and Sign in, in the thumb zone. */
export const actions = style({
  position: 'relative',
  zIndex: 2,
  gridRow: '2',
  alignSelf: 'end',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'actions',
})
/** Sign in, quiet, on the shade. */
export const quietAction = style({ backgroundColor: 'ink', color: 'paper' })
export const noWrap = style({ whiteSpace: 'nowrap' })

/** The screens between the hero and the ending carry Start free with them: it rests at the bottom of the screen (the
 * bottom right on a wide one) while any of them shows, and never covers the hero or the ending. */
export const screens = style({ position: 'relative' })
export const pinned = style({
  position: 'sticky',
  insetBlockStart: 'calc(100svh - 72px - env(safe-area-inset-bottom))',
  zIndex: 3,
  display: 'flex',
  justifyContent: 'center',
  blockSize: '0',
  overflow: 'visible',
  '@media (min-aspect-ratio: 4/5)': { justifyContent: 'flex-end', paddingInline: 'clamp(24px, 5vw, 72px)' },
})
export const pinnedAction = style({ blockSize: 'fit-content', boxShadow: 'lift1' })

// The rail: an oak rod fixed across the screen, the pieces hanging from it in a row that swipes; the one in front turns
// from its side to its front through its sprite's 30 frames.

export const railStage = style({
  position: 'relative',
  gridRow: '1',
  alignSelf: 'center',
  marginInline: 'calc(-1 * max(20px, env(safe-area-inset-left), env(safe-area-inset-right)))',
  paddingBlockStart: '28px',
  '@media (min-aspect-ratio: 4/5)': { gridRow: '1 / -1', gridColumn: '2', marginInline: '0' },
})
export const railRod = style({
  position: 'absolute',
  insetBlockStart: '0',
  insetInline: '0',
  blockSize: '5px',
  borderRadius: 'pill',
  backgroundImage: 'linear-gradient(to bottom, #d9b98a, #b48c58 55%, #8f6a3d)',
  boxShadow: '0 3px 6px oklch(0.3 0.04 60 / 0.18) !custom',
})
export const railRow = style({
  display: 'flex',
  gap: 'related',
  overflowX: 'auto',
  overscrollBehaviorX: 'contain',
  scrollSnapType: 'x mandatory',
  scrollbarWidth: 'none',
  paddingInline: 'calc(50% - min(37vw, 160px))',
  // The pieces fade out at the screen's edges instead of being cut by them.
  maskImage: 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)',
})
export const railPiece = style({
  position: 'relative',
  flex: '0 0 auto',
  inlineSize: 'min(74vw, 320px)',
  aspectRatio: '384 / 448',
  scrollSnapAlign: 'center',
  backgroundRepeat: 'no-repeat',
  // Thirty frames in one row: the position steps from the first (the side) to the last (the front).
  backgroundSize: '3000% 100%',
  backgroundPosition: '0% 0%',
  transitionProperty: 'background-position',
  transitionDuration: 'turn',
  transitionTimingFunction: 'turnFrames',
  '&[data-front]': { backgroundPosition: '100% 0%' },
  // The hanger's wire up to the rod.
  '::before': {
    content: '""',
    position: 'absolute',
    insetBlockStart: '-28px',
    insetInlineStart: 'calc(50% - 0.5px)',
    inlineSize: '1px',
    blockSize: '34px',
    backgroundColor: 'ink3',
  },
})
// Each sprite loads only once the rail nears the screen (the view adds these then).
export const coatCamel = style({ backgroundImage: "url('/cdn/landing/turn-coat-camel.webp')" })
export const sweaterCream = style({ backgroundImage: "url('/cdn/landing/turn-sweater-cream.webp')" })
export const dressSage = style({ backgroundImage: "url('/cdn/landing/turn-dress-sage.webp')" })
export const shirtWhite = style({ backgroundImage: "url('/cdn/landing/turn-shirt-white.webp')" })
export const topStripe = style({ backgroundImage: "url('/cdn/landing/turn-top-stripe.webp')" })

// Ask Styld: the question, then Styld's answer with its four pieces, played in each time the chat comes into view.

const rise = keyframes({ from: { opacity: 0, transform: 'translateY(10px)' } }, { id: 'styld-landing-rise' })
export const chat = style({
  gridRow: '1',
  alignSelf: 'center',
  justifySelf: 'center',
  display: 'grid',
  gap: 'related',
  inlineSize: 'min(100%, 26rem)',
  '@media (min-aspect-ratio: 4/5)': { gridRow: '1 / -1', gridColumn: '2' },
  // Waiting to play: hidden only where motion is allowed, so reduced motion shows the answer at once. The question
  // comes at once, Styld's answer with its pieces a moment later.
  '@media (prefers-reduced-motion: no-preference)': {
    '& > *': { opacity: 0 },
    '&[data-play] > :nth-child(1)': {
      animationName: rise,
      animationDuration: vars.transitionDuration.enter,
      animationTimingFunction: vars.ease.out,
      animationFillMode: 'both',
      animationDelay: vars.transitionDuration.instant,
    },
    '&[data-play] > :nth-child(2)': {
      animationName: rise,
      animationDuration: vars.transitionDuration.enter,
      animationTimingFunction: vars.ease.out,
      animationFillMode: 'both',
      animationDelay: vars.transitionDuration.spring,
    },
  },
})
export const question = style({
  justifySelf: 'end',
  maxInlineSize: '85%',
  margin: '0',
  paddingBlock: '12px',
  paddingInline: '16px',
  borderRadius: 'sheet',
  borderEndEndRadius: 'photo',
  backgroundColor: 'ink',
  color: 'paper',
  lineHeight: 1.4,
})
export const answer = style({
  justifySelf: 'start',
  maxInlineSize: '92%',
  display: 'grid',
  gap: 'close',
  paddingBlock: '12px',
  paddingInline: '16px',
  borderRadius: 'sheet',
  borderEndStartRadius: 'photo',
  backgroundColor: 'stock',
  boxShadow: 'lift1',
  lineHeight: 1.4,
})
export const answerText = style({ margin: '0' })
export const answerPieces = style({ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'snug' })
export const answerPiece = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '3 / 4',
  objectFit: 'contain',
  padding: '4px',
  borderRadius: 'field',
  backgroundColor: 'paper2',
})

// The ending: the way in first, then the price and the questions as small print.

export const ending = style({
  display: 'grid',
  gap: 'columnWide',
  maxInlineSize: '640px',
  marginInline: 'auto',
  paddingBlock: '96px calc(48px + env(safe-area-inset-bottom))',
  paddingInline: 'max(20px, env(safe-area-inset-left), env(safe-area-inset-right))',
})
export const final = style({ display: 'grid', justifyItems: 'start', gap: 'gutter' })
export const finalTitle = style({ textShadow: 'none', maxInlineSize: '9ch' })
export const price = style({ display: 'grid', gap: 'grid' })
export const priceLead = style({ margin: '0', fontSize: 'subheading', textWrap: 'pretty' })
export const prices = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'grid',
  margin: '0',
})
export const priceRow = style({ display: 'grid', gap: 'hairline' })
export const priceTerm = style({ fontWeight: 600 })
export const priceText = style({ margin: '0', fontSize: 'control', color: 'ink2', fontVariantNumeric: 'tabular-nums' })
export const questions = style({
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
export const questionItem = style({
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
  '&[open] summary::after': { transform: 'rotate(45deg)' },
})
export const questionSummary = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'grid',
  minBlockSize: '48px',
  cursor: 'pointer',
  listStyleType: 'none',
  '::-webkit-details-marker': { display: 'none' },
  '::after': {
    content: '"+"',
    color: 'ink3',
    transitionProperty: 'transform',
    transitionDuration: 'brief',
    transitionTimingFunction: 'standard',
  },
})
export const questionAnswer = style({
  margin: '0',
  paddingBlockEnd: '14px',
  maxInlineSize: '52ch',
  fontSize: 'control',
  color: 'ink2',
})
