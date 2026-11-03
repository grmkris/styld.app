import { style } from '../zyzz.config.ts'
export { actionRow as actions, note } from '../Controls.styles.ts'

// Styles for My Gallery in PhotosView.ts and PhotoView.ts: the person's own outfit photos.
export const photosPage = style({ display: 'grid', gap: 'grid', paddingBlock: '0 40px' })
/** Adding a photo: the button and, under it, what it costs and how it went. */
export const add = style({ display: 'grid', justifyItems: 'start', gap: 'actions' })
/** Photos as portraits: two on a phone, four on a wide screen. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'related',
  padding: '0',
  listStyleType: 'none',
  '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'gutter' },
})
export const tile = style({
  position: 'relative',
  display: 'block',
  aspectRatio: '3 / 4',
  overflow: 'hidden',
  borderRadius: 'photo',
  backgroundColor: 'stock',
  transitionProperty: 'transform',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
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
  gap: 'snug',
  paddingBlock: '4px',
  paddingInline: '10px',
  borderRadius: 'pill',
  backgroundColor: 'paper',
  color: 'ink',
  fontSize: 'small',
})
/** A favourite photo's tile: the filled heart in a frosted round at the corner, as on the photo's page. */
export const favouriteBadge = style({
  position: 'absolute',
  insetBlockStart: '8px',
  insetInlineEnd: '8px',
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '32px',
  blockSize: '32px',
  borderRadius: 'pill',
  backgroundColor: 'frost',
  boxShadow: 'overPhoto',
  color: 'ink',
})
/** A photo's own page: its bar, the photo, then what was found in it. */
export const photoPage = style({ display: 'grid', gap: 'grid', paddingBlock: '8px 40px', maxInlineSize: '40rem' })
export const bar = style({ display: 'flex', alignItems: 'center', minBlockSize: '44px' })
export const photo = style({
  display: 'block',
  inlineSize: '100%',
  maxBlockSize: '70vh',
  objectFit: 'contain',
  borderRadius: 'photo',
  backgroundColor: 'stock',
  // The person cut out of it stands on the paper, as a piece's cut-out does.
  '[data-cutout] > &': { backgroundColor: 'paper2' },
})
/** The picture, then its choice of photo or cut-out under it. */
export const pictures = style({ display: 'grid', gap: 'related' })
/** The photo or its cut-out with the favourite over its corner: a sideways swipe chooses between them, so the page
 * keeps vertical scrolling and the picture keeps its text from being selected by the press. */
export const picture = style({ position: 'relative', touchAction: 'pan-y', userSelect: 'none' })
/** The favourite heart: a frosted round over the photo's corner (DESIGN.md › Controls, Round). */
export const favourite = style({
  position: 'absolute',
  insetBlockStart: '10px',
  insetInlineEnd: '10px',
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  padding: '0',
  borderWidth: '0',
  borderRadius: 'pill',
  backgroundColor: 'frost',
  boxShadow: 'overPhoto',
  color: 'ink',
  cursor: 'pointer',
  transitionProperty: 'transform',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  ':active': { transform: 'scale(0.94)' },
  ':disabled': { cursor: 'default' },
})
/** While the outfit is cut out: the photo dims under a frosted note that says so. */
export const cutting = style({
  position: 'absolute',
  insetBlockEnd: '12px',
  insetInlineStart: '12px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'snug',
  margin: '0',
  paddingBlock: '6px',
  paddingInline: '12px',
  borderRadius: 'pill',
  backgroundColor: 'frost',
  boxShadow: 'overPhoto',
  color: 'ink',
  fontSize: 'small',
})
/** The photo or the cut-out, chosen by name under the picture once both exist. */
export const pictureChoice = style({ display: 'flex', justifyContent: 'center', gap: 'actions' })
export const title = style({ fontSize: 'panelTitle', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.02em' })
export const garments = style({ display: 'grid', gap: 'related', padding: '0', listStyleType: 'none' })
/** One garment: its cut-out, and beside it the piece it is or what to do about it. */
export const garment = style({
  display: 'grid',
  gridTemplateColumns: '88px minmax(0, 1fr)',
  gap: 'related',
  alignItems: 'start',
})
export const thumb = style({
  inlineSize: '88px',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'inset',
  backgroundColor: 'paper',
})
export const match = style({ display: 'grid', gap: 'actions', justifyItems: 'start' })
export const matchPiece = style({ display: 'flex', alignItems: 'center', gap: 'actions', color: 'ink' })
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
  gap: 'actions',
  inlineSize: '100%',
})
export const pick = style({
  display: 'grid',
  gap: 'tight',
  justifyItems: 'center',
  padding: '4px',
  borderRadius: 'inset',
  backgroundColor: 'paper',
  fontSize: 'micro',
  color: 'ink2',
})
export const confirm = style({
  display: 'grid',
  gap: 'related',
  padding: '20px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
})
/** A piece's photos: a row of small portraits under its facts. */
export const inPhotosTitle = style({ fontSize: 'control', fontWeight: 600, marginBlockStart: '8px' })
export const inPhotos = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 'actions',
  padding: '0',
  listStyleType: 'none',
})
