import { cutoutGlow, pressThenHover, style } from '../zyzz.config.ts'

// What's new on Home: one card for every kind of item (a board gone public, a pin, a shared look), a picture at 4:5,
// one line of name and one of whose it is, so a strip of them is as tall as its skeleton.

export const section = style({ display: 'grid', gap: 'related', minInlineSize: '0' })
export const title = style({ margin: '0', fontSize: 'heading', fontWeight: 600 })

/** The strip's own height, kept whatever it holds: cards, their outline while they come, or one line. */
export const stripBox = style({ minBlockSize: '262px', minInlineSize: '0' })

/** The newest along one row that scrolls sideways and stops on each card; it runs to the screen's edge on a phone. */
export const strip = style({
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: '148px',
  gap: 'related',
  margin: '0',
  padding: '0 0 8px',
  listStyle: 'none',
  overflowX: 'auto',
  overscrollBehaviorX: 'contain',
  scrollSnapType: 'x mandatory',
  scrollbarWidth: 'none',
})
/** The rest of the list: as many cards across as fit. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
  gap: 'related',
  margin: '0',
  padding: '0',
  listStyle: 'none',
})
export const slot = style({ display: 'grid', minInlineSize: '0', scrollSnapAlign: 'start' })

export const card = style({
  display: 'grid',
  gridTemplateRows: 'auto 20px 24px',
  gap: 'snug',
  minInlineSize: '0',
  padding: '8px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink',
  textDecorationLine: 'none',
  transitionProperty: 'transform',
  transitionDuration: pressThenHover,
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.98)' },
})
/** The picture's 4:5 window: a board's face fills it; a pin or a look lies on paper inside it. */
export const picture = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  aspectRatio: '4 / 5',
  overflow: 'hidden',
  borderRadius: 'photo',
})
export const paper = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr)',
  placeItems: 'center',
  backgroundColor: 'paper',
  boxShadow: 'edge',
})
export const cutout = style({
  inlineSize: '100%',
  blockSize: '100%',
  minBlockSize: '0',
  padding: '10px',
  objectFit: 'contain',
  mixBlendMode: 'darken',
  // DESIGN.md › Dark: no blend on the dark paper, where darken would sink a dark garment.
  '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
})
export const photo = style({ inlineSize: '100%', blockSize: '100%', minBlockSize: '0', objectFit: 'cover' })
export const mosaic = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'tight',
  inlineSize: '100%',
  blockSize: '100%',
  padding: '8px',
  '& img': {
    inlineSize: '100%',
    blockSize: '100%',
    minBlockSize: '0',
    objectFit: 'contain',
    mixBlendMode: 'darken',
    '@media (prefers-color-scheme: dark)': { mixBlendMode: 'normal', filter: cutoutGlow },
  },
})
export const name = style({
  overflow: 'hidden',
  paddingInline: '2px',
  fontSize: 'label',
  fontWeight: 600,
  lineHeight: '20px',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
export const by = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'snug',
  minInlineSize: '0',
  paddingInline: '2px',
  fontSize: 'small',
  color: 'ink2',
})
export const byName = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

/** Nothing new yet, or the newest did not load: one line and its action, in the strip's height. */
export const stripLine = style({
  display: 'grid',
  alignContent: 'center',
  justifyItems: 'start',
  gap: 'related',
  padding: '20px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
export const lineText = style({ margin: '0', color: 'ink2', textWrap: 'pretty' })

export const more = style({ display: 'grid', justifyItems: 'start', gap: 'related' })
/** Read more as the list's end comes within 600px of the screen; it takes no room. */
export const sentinel = style({ blockSize: '1px', marginBlockStart: '-1px' })
export const loading = style({ display: 'flex', alignItems: 'center', gap: 'actions', margin: '0', color: 'ink2' })
