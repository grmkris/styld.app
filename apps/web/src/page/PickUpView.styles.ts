import { cutoutGlow, style } from '../zyzz.config.ts'

// Home's Pick up where you left off (Gallery 2: docs/design/gallery-2/site/v2/home.html, `.rc`).

export const pickUp = style({ display: 'grid', gap: 'related' })
/** Two ways to pick up side by side, as tall as each other, each with its action at its foot. */
export const cards = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  alignItems: 'stretch',
  gap: 'related',
})
/** The prototype's `.rc`: a stock card with what it is, then its action. */
export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 'actions',
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
  // The ratio wins over the pictures' own heights, so the card lines up with the board's window beside it.
  gridTemplateRows: 'minmax(0, 1fr)',
  minBlockSize: '0',
  overflow: 'hidden',
  gap: 'snug',
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
  // DESIGN.md › Dark: no blend on the dark paper, where darken would sink a dark garment.
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
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
/** A favourite outfit photo in its card's 16:10 window, centred on the outfit. */
export const photoCrop = style({
  inlineSize: '100%',
  aspectRatio: '16 / 10',
  objectFit: 'cover',
  objectPosition: '50% 35%',
})
