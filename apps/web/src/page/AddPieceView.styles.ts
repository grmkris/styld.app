import { style } from '../zyzz.config.ts'

// Styles for adding a piece by hand in AddPieceView.ts (Gallery has no screen for it; it follows login.html's form).
export const addPage = style({ display: 'grid', gap: '8px', maxInlineSize: '36rem', paddingBlock: '8px 48px' })
export const pageBar = style({ display: 'flex', alignItems: 'center', gap: '8px' })
export const back = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: '44px',
  blockSize: '44px',
  borderRadius: 'pill',
  color: 'ink',
  '@media (hover: hover) and (pointer: fine)': { ':hover': { backgroundColor: 'paper2' } },
})
export const lede = style({ color: 'ink2' })
/** The photo drop zone: a dashed stock panel that takes a click or a dropped photo. */
export const dropZone = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  gap: '8px',
  minBlockSize: '200px',
  marginBlockStart: '16px',
  padding: '24px',
  borderWidth: '1.5px',
  borderStyle: 'dashed',
  borderColor: 'rule',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  color: 'ink2',
  textAlign: 'center',
  cursor: 'pointer',
  '&[data-drag-over]': { borderColor: 'ink', backgroundColor: 'paper2' },
  '&[aria-invalid="true"]': { borderColor: 'invalid' },
})
export const dropTitle = style({ color: 'ink', fontWeight: 600 })
export const preview = style({
  display: 'block',
  inlineSize: '100%',
  maxBlockSize: '360px',
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  borderRadius: 'photo',
})
export const photoActions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' })
/** A small secondary pill that is a label for the hidden file input. */
export const changePhoto = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '44px',
  paddingInline: '16px',
  borderWidth: '1.5px',
  borderStyle: 'solid',
  borderColor: 'ink',
  borderRadius: 'pill',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
})
export const submit = style({ inlineSize: '100%', marginBlockStart: '24px' })
