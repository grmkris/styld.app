import { style } from '../zyzz.config.ts'

// Styles for My Gallery in PhotosView.ts and PhotoView.ts: the person's own outfit photos.
export const photosPage = style({ display: 'grid', gap: '16px', paddingBlock: '0 40px' })
/** Adding a photo: the button and, under it, what it costs and how it went. */
export const add = style({ display: 'grid', justifyItems: 'start', gap: '8px' })
export const note = style({ fontSize: '14px', color: 'ink2' })
/** Photos as portraits: two on a phone, four on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '12px',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '20px' },
})
export const tile = style({
  position: 'relative',
  display: 'block',
  aspectRatio: '3 / 4',
  overflow: 'hidden',
  borderRadius: 'photo',
  backgroundColor: 'stock',
  transitionProperty: 'transform',
  transitionDuration: '140ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  '&[href]:active': { transform: 'scale(0.98)' },
})
export const tileImage = style({ inlineSize: '100%', blockSize: '100%', objectFit: 'cover' })
/** What a tile says over its photo: still finding, given up, or a favourite. */
export const badge = style({
  position: 'absolute',
  insetBlockEnd: '8px',
  insetInlineStart: '8px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  paddingBlock: '4px',
  paddingInline: '10px',
  borderRadius: 'pill',
  backgroundColor: 'paper',
  color: 'ink',
  fontSize: '13px',
})
/** A photo's own page: its bar, the photo, then what was found in it. */
export const photoPage = style({ display: 'grid', gap: '16px', paddingBlock: '8px 40px', maxInlineSize: '40rem' })
export const bar = style({ display: 'flex', alignItems: 'center', minBlockSize: '44px' })
export const photo = style({
  inlineSize: '100%',
  maxBlockSize: '70vh',
  objectFit: 'contain',
  borderRadius: 'photo',
  backgroundColor: 'stock',
})
export const title = style({ fontSize: '26px', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.02em' })
export const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' })
export const garments = style({ display: 'grid', gap: '12px', padding: '0', listStyleType: 'none' })
/** One garment: its cut-out, and beside it the piece it is or what to do about it. */
export const garment = style({
  display: 'grid',
  gridTemplateColumns: '88px minmax(0, 1fr)',
  gap: '12px',
  alignItems: 'start',
})
export const thumb = style({
  inlineSize: '88px',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'inset',
  backgroundColor: 'paper',
})
export const match = style({ display: 'grid', gap: '8px', justifyItems: 'start' })
export const matchPiece = style({ display: 'flex', alignItems: 'center', gap: '8px', color: 'ink' })
export const smallThumb = style({
  inlineSize: '44px',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'inset',
})
/** The wardrobe picker under a garment: its pieces of that kind, then none of them. */
export const picker = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
  gap: '8px',
  inlineSize: '100%',
})
export const pick = style({
  display: 'grid',
  gap: '4px',
  justifyItems: 'center',
  padding: '4px',
  borderRadius: 'inset',
  backgroundColor: 'paper',
  fontSize: '12px',
  color: 'ink2',
})
export const confirm = style({
  display: 'grid',
  gap: '12px',
  padding: '20px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
