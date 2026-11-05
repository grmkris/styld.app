import { keyframes } from 'zyzz/web'
import {
  brassRod,
  filmLineEdge,
  filmShade,
  filmShadeWide,
  filmTitleEdge,
  heroShade,
  heroShadeWide,
  style,
  vars,
} from '../zyzz.config.ts'

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
  // One column that may shrink below its content: the rail's row is wider than the screen and scrolls inside it.
  gridTemplateColumns: 'minmax(0, 1fr)',
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
export const paperScreen = style({
  backgroundColor: 'paper',
  color: 'ink',
  // Wide: the words on the left, the rail or the chat beside them.
  '@media (min-aspect-ratio: 4/5)': {
    gridTemplateColumns: 'minmax(0, 28rem) minmax(0, 1fr)',
    gridTemplateRows: 'minmax(0, 1fr)',
    columnGap: 'columns',
  },
})

/** The poster and the film fill the screen; a shade under the words keeps them legible on any frame. */
export const film = style({
  position: 'absolute',
  inset: '0',
  margin: '0',
  '::after': {
    content: '""',
    position: 'absolute',
    inset: '0',
    backgroundImage: filmShade,
    pointerEvents: 'none',
  },
  '@media (min-aspect-ratio: 4/5)': {
    '::after': {
      backgroundImage: filmShadeWide,
    },
  },
})
/** The hero's shade is at the top, under its statement. */
export const heroFilm = style({
  '::after': {
    backgroundImage: heroShade,
  },
  '@media (min-aspect-ratio: 4/5)': {
    '::after': {
      backgroundImage: heroShadeWide,
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
  textShadow: filmTitleEdge,
})
export const line = style({
  margin: '0',
  maxInlineSize: '32ch',
  fontSize: 'subheading',
  lineHeight: 1.45,
  textWrap: 'pretty',
  textShadow: filmLineEdge,
  '@media (min-aspect-ratio: 4/5)': { maxInlineSize: '34ch' },
})
/** On paper the words are ink and need no edge. */
export const paperWords = style({
  '& h2': { textShadow: 'none' },
  '& p': { color: 'ink2', textShadow: 'none' },
  '@media (min-aspect-ratio: 4/5)': { gridRow: '1', gridColumn: '1', alignSelf: 'center' },
})

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
  insetBlockStart: 'calc(100svh - 20px - env(safe-area-inset-bottom))',
  zIndex: 3,
  display: 'flex',
  justifyContent: 'center',
  blockSize: '0',
  overflow: 'visible',
  '@media (min-aspect-ratio: 4/5)': { justifyContent: 'flex-end', paddingInline: 'clamp(24px, 5vw, 72px)' },
})
/** The pill rises from its resting point, so at the end of the screens it stops above the footer instead of over it. */
export const pinnedAction = style({ blockSize: 'fit-content', boxShadow: 'lift1', translate: '0 -100%' })

// The rail (RailPlayer.ts): an oak rod across the rack, the pieces hanging from it by their wires. The rack sets each
// piece's width (`--garment-width`) and, on a phone, a row that swipes (`--rail-layout`); the player reads both back,
// sets each piece's place (`left`) through the CSSOM and draws its frames on its canvas.

export const rack = style({
  position: 'relative',
  gridRow: '1',
  alignSelf: 'center',
  blockSize: '440px',
  marginInline: 'calc(-1 * max(20px, env(safe-area-inset-left), env(safe-area-inset-right)))',
  overflow: 'hidden',
  touchAction: 'pan-y',
  userSelect: 'none',
  // The pieces fade out at the screen's edges instead of being cut by them.
  maskImage: 'linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)',
  // A piece at rest shows its side, a narrow target; a phone's row shows every piece at its whole width.
  '--garment-width': '370px',
  '--garment-rest': '60px',
  '--rail-layout': 'hover',
  '@media (min-aspect-ratio: 4/5)': { gridRow: '1', gridColumn: '2', marginInline: '0', blockSize: 'min(100%, 540px)' },
  '@media (min-width: 1400px)': { '--garment-width': '400px' },
  '@media (max-width: 700px)': { '--garment-width': '315px', '--garment-rest': '315px', '--rail-layout': 'swipe' },
})
export const rod = style({
  position: 'absolute',
  insetBlockStart: '30px',
  insetInline: '0',
  blockSize: '5px',
  borderRadius: 'pill',
  backgroundImage: brassRod,
  boxShadow: 'rod',
})
/** A piece: a narrow target while it shows its side, its whole width once it turns to the front. */
export const garment = style({
  position: 'absolute',
  insetBlockStart: '34px',
  insetInlineStart: '0',
  zIndex: 1,
  inlineSize: 'var(--garment-rest)',
  blockSize: 'calc(var(--garment-width) * 448 / 384)',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  transform: 'translateX(-50%)',
  cursor: 'pointer',
  '&[data-active]': { zIndex: 2, inlineSize: 'var(--garment-width)' },
})
export const wire = style({
  position: 'absolute',
  insetBlockStart: '0',
  insetInlineStart: 'calc(50% - 0.5px)',
  inlineSize: '1px',
  blockSize: '36px',
  backgroundColor: 'ink3',
})
export const garmentCanvas = style({
  position: 'absolute',
  insetBlockStart: '24px',
  insetInlineStart: 'calc(50% - var(--garment-width) / 2)',
  inlineSize: 'var(--garment-width)',
  blockSize: 'auto',
  pointerEvents: 'none',
})

// Ask Styld: the question, then Styld's answer with its four pieces, played in each time the chat comes into view.

// It ends visible: the chat's children wait at opacity 0, so the end state cannot be left to the element.
const rise = keyframes(
  { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
  { id: 'styld-landing-rise' },
)
export const chat = style({
  gridRow: '1',
  alignSelf: 'center',
  justifySelf: 'center',
  display: 'grid',
  gap: 'related',
  inlineSize: 'min(100%, 26rem)',
  '@media (min-aspect-ratio: 4/5)': { gridRow: '1', gridColumn: '2' },
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

// ChatGPT and Claude: the question in the visitor's own assistant, and Styld's card answering it inside the chat.

/** A plain host window around the chat: neither assistant's own screen. */
export const host = style({
  paddingBlock: '20px',
  paddingInline: '16px',
  borderRadius: 'sheet',
  backgroundColor: 'paper2',
})
export const hostQuestion = style({ backgroundColor: 'stock', color: 'ink' })
export const card = style({
  justifySelf: 'start',
  display: 'grid',
  gap: 'close',
  inlineSize: 'min(100%, 22rem)',
  padding: '14px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  boxShadow: 'lift1',
})
export const cardName = style({ margin: '0', fontFamily: 'voice', fontSize: 'heading', lineHeight: 1 })
export const cardLine = style({ margin: '0', fontSize: 'label', color: 'ink2' })

// The ending: the plans and the questions as small print, clear of Start free resting at the bottom.

export const ending = style({
  display: 'grid',
  gap: 'columnWide',
  maxInlineSize: '640px',
  marginInline: 'auto',
  paddingBlock: '72px calc(112px + env(safe-area-inset-bottom))',
  paddingInline: 'max(20px, env(safe-area-inset-left), env(safe-area-inset-right))',
})
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
