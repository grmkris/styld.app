import { style } from '../zyzz.config.ts'

// A board as a list shows it, in BoardFace.ts.

/** A board without a collage shows its newest pins two by two. */
export const cover = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '4px',
  aspectRatio: '4 / 5',
  pointerEvents: 'none',
})
export const coverTile = style({ display: 'grid', minBlockSize: '0' })
/** A board with nothing pinned: its paper, with the words over it. */
export const blank = style({ display: 'grid', '& > *': { gridArea: '1 / 1' } })
export const blankWords = style({
  alignSelf: 'center',
  justifySelf: 'center',
  paddingInline: '12px',
  color: 'ink3',
  fontSize: '13px',
  textAlign: 'center',
  textWrap: 'balance',
})
