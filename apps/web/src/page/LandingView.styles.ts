import { cutoutGlow, landingVeilTall, landingVeilWide, style } from '../zyzz.config.ts'

// The signed-out Home (LandingView.ts): the film is the one bold thing; below it, quiet blocks made of Styld's own
// material. A phone held upright gets the tall film and its words at the top, the actions in the thumb zone; anything
// wider (`min-aspect-ratio: 4/5`, the film's own switch) the wide film and the words in a left column.

/** The site frame on the landing: the film runs edge to edge, so the frame gives up its width and the bar and footer
 * keep theirs. */
export const site = style({
  maxInlineSize: 'none',
  paddingInline: '0',
  '& > header, & > footer': {
    maxInlineSize: '78rem',
    marginInline: 'auto',
    paddingInline: 'max(20px, env(safe-area-inset-left), env(safe-area-inset-right))',
  },
  // The bar lies over the film.
  '& > header': { position: 'absolute', insetBlockStart: '0', insetInline: '0', zIndex: 2 },
})

/** One screen tall (svh, so the address bar never resizes the film), the words over the film. */
export const hero = style({
  position: 'relative',
  display: 'grid',
  gridTemplateRows: '1fr auto',
  blockSize: '100svh',
  minBlockSize: '560px',
  overflow: 'hidden',
  paddingBlock: 'calc(76px + env(safe-area-inset-top)) max(24px, env(safe-area-inset-bottom))',
  paddingInline: 'max(20px, env(safe-area-inset-left), env(safe-area-inset-right))',
  backgroundColor: 'paper2',
  '::before': {
    content: '""',
    position: 'absolute',
    inset: '0',
    zIndex: 1,
    backgroundImage: landingVeilTall,
    pointerEvents: 'none',
  },
  '@media (min-aspect-ratio: 4/5)': {
    gridTemplateRows: 'auto auto',
    alignContent: 'center',
    rowGap: 'column',
    paddingInline: 'max(clamp(20px, 6vw, 96px), env(safe-area-inset-left))',
    '::before': { backgroundImage: landingVeilWide },
  },
})

/** The poster and the film over it fill the hero; the subject keeps the middle. */
export const film = style({ position: 'absolute', inset: '0', margin: '0' })
export const filmMedia = style({
  position: 'absolute',
  inset: '0',
  display: 'block',
  inlineSize: '100%',
  blockSize: '100%',
  objectFit: 'cover',
})

export const words = style({
  position: 'relative',
  zIndex: 2,
  display: 'grid',
  alignContent: 'start',
  gap: 'grid',
})
/** The landing statement: Display, the one heavy head on the page. */
export const title = style({
  margin: '0',
  maxInlineSize: '14ch',
  fontSize: 'display',
  lineHeight: 1,
  fontWeight: 700,
  letterSpacing: '-0.035em',
  textWrap: 'balance',
})
export const lede = style({
  margin: '0',
  maxInlineSize: '46ch',
  fontSize: 'subheading',
  color: 'ink2',
  textWrap: 'pretty',
})

/** Start free and Sign in: in the thumb zone on a phone, under the sentence elsewhere. */
export const actions = style({
  position: 'relative',
  zIndex: 2,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'actions',
  // Clear of the film's control at the end of the row.
  paddingInlineEnd: '56px',
  '@media (min-aspect-ratio: 4/5)': { paddingInlineEnd: '0' },
})
/** Sign in, quiet: on the veil, so it reads on any frame. */
export const quietAction = style({ backgroundColor: 'stock' })

/** The film's one control: a 44px round on the scrim at the hero's bottom end. */
export const filmControl = style({
  position: 'absolute',
  zIndex: 3,
  insetInlineEnd: 'max(20px, env(safe-area-inset-right))',
  insetBlockEnd: 'calc(max(24px, env(safe-area-inset-bottom)) + 2px)',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'scrim',
  color: 'swatchWhite',
  cursor: 'pointer',
  transitionProperty: 'transform',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.96)' },
})

/** The page below the film: one column of blocks up to 1200px, with fluid gutters. */
export const page = style({
  display: 'grid',
  maxInlineSize: '1200px',
  marginInline: 'auto',
  paddingInline: 'max(clamp(20px, 5vw, 48px), env(safe-area-inset-left), env(safe-area-inset-right))',
  paddingBlockEnd: '24px',
})

/** A feature screen: about a screen tall on a phone, words then media; side by side once there is room, the words
 * first every time. */
export const feature = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
  alignItems: 'start',
  alignContent: 'center',
  gap: 'column',
  minBlockSize: 'min(100svh, 52rem)',
  paddingBlock: '48px',
})
/** The words at the top of their block; beside the media on a wide screen they stay in view while it scrolls by. */
export const featureWords = style({
  display: 'grid',
  alignSelf: 'start',
  alignContent: 'start',
  gap: 'related',
  maxInlineSize: '46ch',
  '@media (min-width: 760px)': { position: 'sticky', insetBlockStart: '96px' },
})
export const heading = style({
  margin: '0',
  fontSize: 'title',
  lineHeight: 1.1,
  fontWeight: 700,
  letterSpacing: '-0.02em',
  textWrap: 'balance',
})
export const text = style({ margin: '0', color: 'ink2', textWrap: 'pretty' })

/** A tall clip as a photo: 4px corners and a hairline, as tall as fits the screen. */
export const photoClip = style({
  display: 'block',
  justifySelf: 'center',
  inlineSize: 'min(100%, 70svh * 9 / 16, 420px)',
  aspectRatio: '9 / 16',
  objectFit: 'cover',
  borderRadius: 'photo',
  outlineWidth: '1px',
  outlineStyle: 'solid',
  outlineColor: 'shade2',
  outlineOffset: '-1px',
  backgroundColor: 'paper2',
})
/** A tall clip on a table: the 4:5 sheet of paper outfits are laid on. */
export const tableClip = style({
  display: 'block',
  justifySelf: 'center',
  inlineSize: 'min(100%, 70svh * 4 / 5, 520px)',
  aspectRatio: '4 / 5',
  objectFit: 'cover',
  borderRadius: 'table',
  backgroundColor: 'stock',
})

/** The shop: the chips over the grid of cut-outs on paper. */
export const shop = style({ display: 'grid', gap: 'section', alignContent: 'start' })
export const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions', margin: '0', padding: '0' })
/** A chip as tall as its target: 44px, so neighbouring rows' targets never overlap. */
export const shopChip = style({ minBlockSize: '44px', '::after': { insetBlock: '0' } })
export const grid = style({
  display: 'grid',
  // Six pieces: three rows of two on a phone, two rows of three once there is room.
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  '@media (min-width: 760px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  rowGap: 'section',
  columnGap: 'grid',
  margin: '0',
  padding: '0',
  listStyleType: 'none',
})
export const piece = style({ display: 'grid', gap: 'tight', fontSize: 'label' })
/** A cut-out as it lies: no frame, no outline, its own edge glowing faintly on dark paper. */
export const cutout = style({
  display: 'block',
  inlineSize: '100%',
  aspectRatio: '4 / 5',
  objectFit: 'contain',
  '@media (prefers-color-scheme: dark)': { filter: cutoutGlow },
})
export const pieceName = style({ fontWeight: 600 })
/** Where a shop's price would be. */
export const pieceTag = style({ color: 'ink3' })

/** The price, a two-row list: what each way costs and what it gives. */
export const price = style({ display: 'grid', gap: 'section', paddingBlock: '48px', maxInlineSize: '46rem' })
export const prices = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
  margin: '0',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
export const priceRow = style({
  display: 'grid',
  gap: 'tight',
  paddingBlock: '16px',
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
})
export const priceTerm = style({ fontSize: 'subheading', fontWeight: 600 })
export const priceText = style({ margin: '0', color: 'ink2', fontVariantNumeric: 'tabular-nums' })

/** Four questions, hairlines between, nothing that animates open. */
export const faq = style({ display: 'grid', gap: 'section', paddingBlock: '48px', maxInlineSize: '46rem' })
export const questions = style({
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
})
export const question = style({
  borderBlockEndWidth: '1px',
  borderBlockEndStyle: 'solid',
  borderBlockEndColor: 'rule',
})
export const questionSummary = style({
  display: 'flex',
  alignItems: 'center',
  minBlockSize: '56px',
  paddingBlock: '12px',
  fontSize: 'subheading',
  fontWeight: 600,
  cursor: 'pointer',
})
export const answer = style({ margin: '0', paddingBlockEnd: '16px', maxInlineSize: '60ch', color: 'ink2' })

/** The call to action again: one Display line and Start free. */
export const final = style({
  display: 'grid',
  justifyItems: 'start',
  gap: 'section',
  paddingBlock: '64px 96px',
})
