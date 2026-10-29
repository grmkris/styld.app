import { style } from '../zyzz.config.ts'

// Styles for the held-up camera in HeldCameraView.ts (Gallery has no screen for it; it follows add.html's panels).
/** The live picture: as tall as a phone allows, with the controls beneath it. */
export const panel = style({ display: 'grid', gap: '12px', marginBlockStart: '16px' })
export const picture = style({
  position: 'relative',
  overflow: 'hidden',
  aspectRatio: '3 / 4',
  maxBlockSize: '68dvh',
  inlineSize: '100%',
  borderRadius: 'panel',
  backgroundColor: 'ink',
  cursor: 'pointer',
  '&:focus-visible': { outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'focus', outlineOffset: '2px' },
})
export const video = style({
  display: 'block',
  inlineSize: '100%',
  blockSize: '100%',
  objectFit: 'cover',
  // The selfie camera previews like a mirror; the photos it takes are not mirrored.
  '&[data-facing="user"]': { transform: 'scaleX(-1)' },
})
/** What the camera is doing, over the bottom of the picture. */
export const status = style({
  position: 'absolute',
  insetInline: '12px',
  insetBlockEnd: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minBlockSize: '40px',
  paddingInline: '16px',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 600,
  textAlign: 'center',
  '&[data-hint="taken"]': { backgroundColor: 'ink', color: 'onInk' },
})
export const count = style({
  position: 'absolute',
  insetBlockStart: '12px',
  insetInlineEnd: '12px',
  minInlineSize: '32px',
  paddingBlock: '4px',
  paddingInline: '10px',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'center',
})
export const controls = style({ display: 'flex', gap: '8px' })
export const grow = style({ flexGrow: 1 })
export const failed = style({
  display: 'grid',
  gap: '12px',
  marginBlockStart: '16px',
  padding: '16px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  fontSize: '14px',
})
