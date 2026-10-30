import { keyframes } from 'zyzz/web'
import { style } from '../zyzz.config.ts'

// Styles for the held-up camera in HeldCameraView.ts. Gallery has no camera screen; this one is the phone
// camera's: the picture edge to edge, bars over it that fade from the veil, a round shutter, and the stack
// of photos taken. Motion follows DESIGN.md › Motion.

const curve = 'cubic-bezier(0.2, 0, 0, 1)'

/** A photo taken: the picture flashes once. */
const flashOut = keyframes({ from: { opacity: 0.7 }, to: { opacity: 0 } }, { id: 'styld-camera-flash' })
/** The photo shrinks from the middle of the screen into the stack, bottom left. */
const flyIn = keyframes(
  {
    from: {
      transform: 'translate(calc(50vw - 56px), calc(76px + env(safe-area-inset-bottom) - 50dvh)) scale(5)',
      opacity: 0.6,
    },
  },
  { id: 'styld-camera-fly' },
)

/** The camera screen, a dialog over the whole page, the scrollbar's gutter too. */
export const screen = style({
  inlineSize: '100vw',
  blockSize: '100dvh',
  maxInlineSize: 'none',
  maxBlockSize: 'none',
  margin: '0',
  padding: '0',
  borderStyle: 'none',
  backgroundColor: 'ink',
  color: 'onInk',
  overflow: 'hidden',
  overscrollBehavior: 'contain',
})
export const stage = style({ position: 'absolute', inset: '0' })
export const video = style({
  position: 'absolute',
  inset: '0',
  inlineSize: '100%',
  blockSize: '100%',
  objectFit: 'cover',
  cursor: 'pointer',
  // The selfie camera previews like a mirror; the photos it takes are not mirrored.
  '&[data-facing="user"]': { transform: 'scaleX(-1)' },
})
/** Corner marks where a piece is held: brighter and drawn in while the check looks. */
export const guide = style({
  position: 'absolute',
  insetBlock: 'calc(64px + env(safe-area-inset-top)) calc(236px + env(safe-area-inset-bottom))',
  insetInline: 'max(32px, env(safe-area-inset-left))',
  borderWidth: '3px',
  borderStyle: 'solid',
  borderColor: 'onInk',
  borderRadius: 'sheet',
  // Only the four corners of the border show.
  mask: 'conic-gradient(at 40px 40px, transparent 75%, black 0) 0 0 / calc(100% - 40px) calc(100% - 40px)',
  opacity: 0.5,
  pointerEvents: 'none',
  transitionProperty: 'opacity, transform',
  transitionDuration: '180ms',
  transitionTimingFunction: curve,
  '&[data-hint="checking"]': { opacity: 1, transform: 'scale(0.97)' },
  '&[data-hint="notSeen"]': { opacity: 0.85 },
})
export const flash = style({
  position: 'absolute',
  inset: '0',
  backgroundColor: 'onInk',
  opacity: 0,
  pointerEvents: 'none',
  animationName: flashOut,
  animationDuration: '240ms',
  animationTimingFunction: 'ease-out',
})
/** The bars over the picture let taps through to it, except on their own controls. */
export const bar = style({
  position: 'absolute',
  insetInline: '0',
  display: 'grid',
  justifyItems: 'center',
  gap: '12px',
  paddingInlineStart: 'max(16px, env(safe-area-inset-left))',
  paddingInlineEnd: 'max(16px, env(safe-area-inset-right))',
  pointerEvents: 'none',
  '& > *': { pointerEvents: 'auto' },
})
export const top = style({
  insetBlockStart: '0',
  gridTemplateColumns: '1fr auto 1fr',
  paddingBlock: 'calc(12px + env(safe-area-inset-top)) 32px',
  backgroundImage: 'linear-gradient(to bottom, oklch(0.2 0.02 50 / 0.6), transparent)',
})
export const bottom = style({
  insetBlockEnd: '0',
  paddingBlock: '48px calc(20px + env(safe-area-inset-bottom))',
  backgroundImage: 'linear-gradient(to top, oklch(0.2 0.02 50 / 0.7), transparent)',
})
/** Front and back, the current one filled. */
export const steps = style({
  gridColumn: '2',
  display: 'flex',
  gap: '2px',
  padding: '3px',
  borderRadius: 'pill',
  backgroundColor: 'scrim',
  fontSize: '13px',
  fontWeight: 600,
})
export const step = style({
  paddingBlock: '4px',
  paddingInline: '12px',
  borderRadius: 'pill',
  transitionProperty: 'background-color, color',
  transitionDuration: '180ms',
  transitionTimingFunction: curve,
  '&[aria-current="step"]': { backgroundColor: 'onInk', color: 'ink' },
})
export const count = style({
  justifySelf: 'end',
  alignSelf: 'center',
  fontSize: '14px',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
})
/** What the camera is doing. */
export const status = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minBlockSize: '40px',
  maxInlineSize: '420px',
  paddingBlock: '8px',
  paddingInline: '16px',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  color: 'ink',
  fontSize: '14px',
  fontWeight: 600,
  textAlign: 'center',
  pointerEvents: 'none',
  '&[data-hint="taken"]': { backgroundColor: 'ink', color: 'onInk' },
})
/** A control that gives a little under the finger. */
export const press = style({
  transitionProperty: 'transform',
  transitionDuration: '140ms',
  transitionTimingFunction: curve,
  '&:active': { transform: 'scale(0.96)' },
})
export const skip = style({
  paddingInline: '16px',
  borderStyle: 'none',
  borderRadius: 'pill',
  backgroundColor: 'scrim',
  color: 'onInk',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
})
export const controls = style({
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  inlineSize: '100%',
  maxInlineSize: '440px',
  paddingInline: '8px',
})
/** Done, as the stack of photos taken. */
export const stack = style({
  justifySelf: 'start',
  display: 'grid',
  justifyItems: 'center',
  gap: '4px',
  padding: '0',
  borderStyle: 'none',
  backgroundColor: 'transparent !custom',
  color: 'onInk',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
})
export const stackFrame = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '52px',
  blockSize: '52px',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'onInk',
  borderRadius: 'field',
  backgroundColor: 'scrim',
})
export const stackPhoto = style({
  position: 'absolute',
  inset: '-2px',
  inlineSize: 'calc(100% + 4px)',
  blockSize: 'calc(100% + 4px)',
  objectFit: 'cover',
  borderRadius: 'field',
  animationName: flyIn,
  animationDuration: '420ms',
  animationTimingFunction: curve,
})
export const shutter = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '80px',
  blockSize: '80px',
  padding: '0',
  borderStyle: 'none',
  borderRadius: 'pill',
  backgroundColor: 'transparent !custom',
  cursor: 'pointer',
  '&:active > span': { transform: 'scale(0.9)' },
})
export const shutterDisc = style({
  transitionProperty: 'transform',
  transitionDuration: '140ms',
  transitionTimingFunction: curve,
  inlineSize: '62px',
  blockSize: '62px',
  borderRadius: 'pill',
  backgroundColor: 'onInk',
})
/** The ring round the shutter fills from the top, in quarters, as the picture settles. */
export const ring = style({ position: 'absolute', inset: '0', transform: 'rotate(-90deg)' })
export const ringTrack = style({ fill: 'none !custom', stroke: 'onInk', strokeWidth: '4px', strokeOpacity: 0.35 })
export const ringFill = style({
  fill: 'none !custom',
  stroke: 'onInk',
  strokeWidth: '4px',
  strokeLinecap: 'round',
  strokeDasharray: 100,
  strokeDashoffset: 100,
  transitionProperty: 'stroke-dashoffset',
  transitionDuration: '180ms',
  transitionTimingFunction: curve,
  '&[data-settle="1"]': { strokeDashoffset: 75 },
  '&[data-settle="2"]': { strokeDashoffset: 50 },
  '&[data-settle="3"]': { strokeDashoffset: 25 },
  '&[data-settle="4"]': { strokeDashoffset: 0 },
})
/** A round control over the picture. */
export const round = style({
  justifySelf: 'end',
  display: 'grid',
  placeItems: 'center',
  inlineSize: '52px',
  blockSize: '52px',
  padding: '0',
  borderStyle: 'none',
  borderRadius: 'pill',
  backgroundColor: 'scrim',
  color: 'onInk',
  cursor: 'pointer',
})
export const failed = style({
  display: 'grid',
  gap: '12px',
  marginBlockStart: '16px',
  padding: '16px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  fontSize: '14px',
})
