import { style } from '../zyzz.config.ts'

// A board as a list shows it, in BoardFace.ts.

/** A board without a collage: its newest pins on its paper as Gallery's mosaic, the first the tallest; one fills it,
 * two stand side by side, three or four share it. */
export const cover = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: '6%',
  padding: '10%',
  pointerEvents: 'none',
  '& > :first-child': { gridRow: 'span 2' },
  '& > :nth-child(2):last-child': { gridRow: 'span 2' },
  '& > :only-child': { gridColumn: 'span 2' },
})
export const coverTile = style({ display: 'grid', minInlineSize: '0', minBlockSize: '0' })
export const coverImage = style({
  inlineSize: '100%',
  blockSize: '100%',
  minBlockSize: '0',
  objectFit: 'contain',
  mixBlendMode: 'darken',
})
/** A board with nothing pinned: its paper, with the words over it. */
export const blank = style({ display: 'grid', '& > *': { gridArea: '1 / 1' } })
export const blankWords = style({
  // Positioned, so it paints over the paper, which is positioned too.
  position: 'relative',
  alignSelf: 'center',
  justifySelf: 'center',
  paddingInline: '12px',
  color: 'ink3',
  fontSize: '13px',
  textAlign: 'center',
  textWrap: 'balance',
})
