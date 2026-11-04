import { cutoutGlow, style } from '../zyzz.config.ts'

export const filters = style({ display: 'flex', flexWrap: 'wrap', gap: 'actions' })
export const filter = style({ minBlockSize: '44px' })
export const image = style({
  inlineSize: '100%',
  blockSize: '100%',
  minBlockSize: '0',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  pointerEvents: 'none',
  // DESIGN.md › Dark: a dark garment keeps its edge on the dark sheet.
  '@media (prefers-color-scheme: dark)': { filter: cutoutGlow },
})
/** A piece's name, or its kind and colour, under its picture: two lines at most. */
export const caption = style({
  display: '-webkit-box',
  overflow: 'hidden',
  paddingInline: '2px',
  fontSize: 'small',
  lineHeight: 1.3,
  color: 'ink2',
  textAlign: 'center',
  overflowWrap: 'anywhere',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
})
export const tile = style({ display: 'grid', alignContent: 'start', gap: 'snug' })
