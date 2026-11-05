import { keyframes } from 'zyzz/web'
import { cameraBottomVeil, cameraTopVeil, style, vars } from '../zyzz.config.ts'

// Styles for the held-up camera in HeldCameraView.ts. Gallery has no camera screen; this one is the phone
// camera's: the picture edge to edge, bars over it that fade from the veil, a round shutter, and the stack
// of photos taken. Motion follows DESIGN.md › Motion.

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

/** The camera screen, a dialog over the whole page, the scrollbar's gutter too. Always the light scheme's colours: its
 * ink ground, on-ink words and scrims sit over the camera's picture, not the paper, so they never turn in dark. */
export const screen = style({
  colorScheme: 'light',
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
  transitionDuration: 'hover',
  transitionTimingFunction: 'standard',
  '&[data-hint="checking"]': { opacity: 1, transform: 'scale(0.97)' },
  '&[data-hint="notSeen"]': { opacity: 0.85 },
})
/** A large, high-contrast count visible from across the room before an automatic shutter. */
export const countdown = style({
  position: 'absolute',
  insetBlock: 'calc(64px + env(safe-area-inset-top)) calc(236px + env(safe-area-inset-bottom))',
  insetInline: '0',
  margin: '0',
  display: 'grid',
  placeItems: 'center',
  pointerEvents: 'none',
  color: 'onInk',
  fontSize: 'countdown',
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
})
export const countdownNumber = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: '1.6em',
  blockSize: '1.6em',
  borderRadius: 'pill',
  backgroundColor: 'scrim',
})
export const flash = style({
  position: 'absolute',
  inset: '0',
  backgroundColor: 'onInk',
  opacity: 0,
  pointerEvents: 'none',
  animationName: flashOut,
  animationDuration: vars.transitionDuration.enter,
  animationTimingFunction: vars.ease.out,
})
/** The bars over the picture let taps through to it, except on their own controls. */
export const bar = style({
  position: 'absolute',
  insetInline: '0',
  display: 'grid',
  justifyItems: 'center',
  gap: 'related',
  paddingInlineStart: 'max(16px, env(safe-area-inset-left))',
  paddingInlineEnd: 'max(16px, env(safe-area-inset-right))',
  pointerEvents: 'none',
  '& > *': { pointerEvents: 'auto' },
})
export const top = style({
  insetBlockStart: '0',
  gridTemplateColumns: '1fr auto 1fr',
  paddingBlock: 'calc(12px + env(safe-area-inset-top)) 32px',
  backgroundImage: cameraTopVeil,
})
export const bottom = style({
  insetBlockEnd: '0',
  paddingBlock: '48px calc(20px + env(safe-area-inset-bottom))',
  backgroundImage: cameraBottomVeil,
})
/** Front and back, the current one filled. */
export const steps = style({
  gridColumn: '2',
  display: 'flex',
  gap: 'hairline',
  padding: '3px',
  borderRadius: 'pill',
  backgroundColor: 'scrim',
  fontSize: 'small',
  fontWeight: 600,
})
export const step = style({
  paddingBlock: '4px',
  paddingInline: '12px',
  borderRadius: 'pill',
  transitionProperty: 'background-color, color',
  transitionDuration: 'hover',
  transitionTimingFunction: 'standard',
  '&[aria-current="step"]': { backgroundColor: 'onInk', color: 'ink' },
})
export const count = style({
  display: 'flex',
  alignItems: 'center',
  gap: 'snug',
  minBlockSize: '44px',
  paddingInline: '12px',
  borderStyle: 'none',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  color: 'ink',
  cursor: 'pointer',
  justifySelf: 'end',
  alignSelf: 'center',
  fontSize: 'label',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
})
/** What the camera is doing. */
export const status = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'actions',
  minBlockSize: '40px',
  maxInlineSize: '420px',
  paddingBlock: '8px',
  paddingInline: '16px',
  borderRadius: 'pill',
  backgroundColor: 'stock',
  color: 'ink',
  fontSize: 'label',
  fontWeight: 600,
  textAlign: 'center',
  pointerEvents: 'none',
  '&[data-hint="taken"]': { backgroundColor: 'ink', color: 'onInk' },
})
/** A control that gives a little under the finger. */
export const press = style({
  transitionProperty: 'transform',
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
  '&:active': { transform: 'scale(0.96)' },
})
export const skip = style({
  paddingInline: '16px',
  borderStyle: 'none',
  borderRadius: 'pill',
  backgroundColor: 'scrim',
  color: 'onInk',
  fontSize: 'label',
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
/** A distinct Finish control containing the last photo. */
export const stack = style({
  justifySelf: 'start',
  display: 'grid',
  justifyItems: 'center',
  gap: 'tight',
  padding: '8px 12px',
  borderStyle: 'none',
  borderRadius: 'field',
  backgroundColor: 'stock',
  color: 'ink',
  fontSize: 'label',
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
  animationDuration: vars.transitionDuration.travel,
  animationTimingFunction: vars.ease.standard,
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
  transitionDuration: 'press',
  transitionTimingFunction: 'standard',
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
  transitionDuration: 'hover',
  transitionTimingFunction: 'standard',
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
  gap: 'related',
  marginBlockStart: '16px',
  padding: '16px',
  borderRadius: 'panel',
  backgroundColor: 'stock',
  fontSize: 'label',
})
