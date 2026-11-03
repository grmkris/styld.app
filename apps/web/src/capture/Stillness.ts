/** Watching the camera for a garment held up and then held still. Frames are small grey copies;
 * the scene must move (someone brings a garment in) and then calm down for a moment before it counts
 * as settled, so an empty room never shoots. A scene that stays put after settling is looked at again
 * a couple of times, since the first look may have caught it badly. */
export interface Watch {
  readonly previous: Uint8Array | undefined
  /** Whether the scene moved since it last settled. */
  readonly moved: boolean
  /** Still frames since the last movement. */
  readonly still: number
  /** Frames in a row without movement: still, or only swaying as a garment held by hand does. */
  readonly calm: number
  /** How often the scene settled since it last moved. */
  readonly settles: number
}

export const startWatch: Watch = { previous: undefined, moved: false, still: 0, calm: 0, settles: 0 }

interface FrameWatch {
  readonly watch: Watch
  readonly settle: Settle
  readonly usable: boolean
  readonly changed: boolean
}

/** A frame this dark or without any texture is a covered/resting camera, not a garment. */
const minimumLuminance = 18
const minimumVariance = 2

const usable = (frame: Uint8Array) => {
  if (frame.length === 0) return false
  let total = 0
  for (const value of frame) total += value
  const mean = total / frame.length
  if (mean < minimumLuminance) return false
  let squared = 0
  for (const value of frame) squared += (value - mean) ** 2
  return squared / frame.length >= minimumVariance
}

/** Mean grey-level change per pixel above which the scene is moving. */
const moving = 10
/** Below this the scene is still. Between the two it only sways, which neither counts as still nor resets. */
const resting = 3
/** Still frames that settle a scene: about 0.6 s at five frames a second. */
const settleFrames = 3
/** Calm frames that settle a scene that never quite stops swaying: about 1 s. */
const calmFrames = 5
/** Calm frames after a settle before the same scene is looked at again: about 2.4 s. */
const againFrames = 12
/** How often a scene that stays put settles before it must move again: the first look and two more. */
const settlesWithoutMoving = 3

/** What a frame did: settled a scene that moved, settled the same scene again, or nothing. */
export type Settle = 'settled' | 'again' | undefined

/** How close a scene that moved is to settling, in quarters: 0 while nothing moved, 4 as it settles. */
export const settlingOf = (watch: Watch): number =>
  watch.moved ? Math.min(4, Math.round(4 * Math.max(watch.still / settleFrames, watch.calm / calmFrames))) : 0

/** The mean absolute difference between two grey frames of the same size. */
const frameChange = (previous: Uint8Array, next: Uint8Array) => {
  let total = 0
  for (let at = 0; at < next.length; at++) total += Math.abs((next[at] ?? 0) - (previous[at] ?? 0))
  return total / Math.max(1, next.length)
}

/** Take one frame into the watch, and say whether it settled the scene. */
export const watchFrame = (watch: Watch, grey: Uint8Array): FrameWatch => {
  if (!usable(grey))
    return { watch: { ...startWatch, previous: grey }, settle: undefined, usable: false, changed: true }
  if (watch.previous === undefined || watch.previous.length !== grey.length)
    return { watch: { ...startWatch, previous: grey }, settle: undefined, usable: true, changed: false }
  const change = frameChange(watch.previous, grey)
  if (change > moving)
    return { watch: { ...startWatch, previous: grey, moved: true }, settle: undefined, usable: true, changed: true }
  const next = {
    ...watch,
    previous: grey,
    still: change < resting ? watch.still + 1 : watch.still,
    calm: watch.calm + 1,
  }
  if (watch.moved && (next.still >= settleFrames || next.calm >= calmFrames))
    return {
      watch: { ...next, moved: false, still: 0, calm: 0, settles: 1 },
      settle: 'settled',
      usable: true,
      changed: false,
    }
  const lookAgain = !watch.moved && watch.settles > 0 && watch.settles < settlesWithoutMoving
  if (lookAgain && next.calm >= againFrames)
    return { watch: { ...next, calm: 0, settles: watch.settles + 1 }, settle: 'again', usable: true, changed: false }
  return { watch: next, settle: undefined, usable: true, changed: false }
}
