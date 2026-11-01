import { style } from '../zyzz.config.ts'

// Styles for the assistant views in Views.ts: the Gallery wardrobe grid inside a host's frame. Hosts block
// web fonts, so the system face stands in for Hanken Grotesk.
export const viewRoot = style({
  display: 'grid',
  gap: 'grid',
  padding: '16px',
  backgroundColor: 'paper',
  color: 'ink',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif !custom',
})
export const heading = style({ fontSize: 'heading', lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em' })
export const empty = style({ color: 'ink2', fontSize: 'body' })
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  rowGap: 'related',
  columnGap: 'grid',
  padding: '0',
  margin: '0',
  listStyleType: 'none',
})
export const tile = style({
  display: 'grid',
  gap: 'snug',
  inlineSize: '100%',
  padding: '0',
  borderWidth: '0',
  backgroundColor: 'transparent !custom',
  color: 'ink2',
  textAlign: 'start',
  cursor: 'pointer',
})
export const pictureFrame = style({ aspectRatio: '1 / 1', borderRadius: 'photo', backgroundColor: 'paper2' })
export const picture = style({ inlineSize: '100%', blockSize: '100%', objectFit: 'contain' })
export const caption = style({ fontSize: 'label', lineHeight: 1.3 })
export const open = style({
  justifySelf: 'start',
  minBlockSize: '44px',
  paddingInline: '20px',
  borderRadius: 'pill',
  borderWidth: '0',
  backgroundColor: 'ink',
  color: 'onInk',
  fontSize: 'control',
  fontWeight: 600,
  cursor: 'pointer',
})
export const subheading = style({ marginBlockEnd: '8px', fontSize: 'subheading', fontWeight: 600 })
/** A board's collage inside the host's frame: no wider than a phone's. */
export const table = style({ maxInlineSize: '420px' })
