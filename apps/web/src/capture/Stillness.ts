/** Watching the camera for a garment held up and then held still. Frames are small grey copies;
 * the scene must move (someone brings a garment in) and then stay still for a moment before it counts
 * as settled, so an empty room or the same garment never shoots twice. */
export interface Watch {
  readonly previous: Uint8Array | undefined
  /** Whether the scene moved since it last settled. */
  readonly moved: boolean
  /** Still frames in a row since the last movement. */
  readonly still: number
}

export const startWatch: Watch = { previous: undefined, moved: false, still: 0 }

/** Mean grey-level change per pixel above which the scene is moving. */
const moving = 10
/** Below this the scene is still. Between the two it is neither, and the count waits. */
const resting = 3
/** Still frames in a row that settle a scene: about 0.6 s at five frames a second. */
const settleFrames = 3

/** The mean absolute difference between two grey frames of the same size. */
const frameChange = (previous: Uint8Array, next: Uint8Array) => {
  let total = 0
  for (let at = 0; at < next.length; at++) total += Math.abs((next[at] ?? 0) - (previous[at] ?? 0))
  return total / Math.max(1, next.length)
}

/** Take one frame into the watch; `settled` says the scene just came to rest after moving. */
export const watchFrame = (watch: Watch, grey: Uint8Array): { readonly watch: Watch; readonly settled: boolean } => {
  if (watch.previous === undefined || watch.previous.length !== grey.length)
    return { watch: { previous: grey, moved: false, still: 0 }, settled: false }
  const change = frameChange(watch.previous, grey)
  if (change > moving) return { watch: { previous: grey, moved: true, still: 0 }, settled: false }
  if (change >= resting) return { watch: { ...watch, previous: grey }, settled: false }
  const still = watch.still + 1
  if (watch.moved && still >= settleFrames) return { watch: { previous: grey, moved: false, still: 0 }, settled: true }
  return { watch: { ...watch, previous: grey, still }, settled: false }
}
