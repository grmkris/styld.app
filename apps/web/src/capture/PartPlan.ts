/** How a long video is cut for Meta SAM, which bills every frame of the file it tracks and follows at
 * most 16 garments at a time: 30-second parts, each an analysis clip at a steady 4 frames a second, with
 * a still each second for the cut-outs. */

/** Each part is this long, except a last one that took in a short tail. */
const partMs = 30_000

/** The longest video Styld reads: fifteen minutes, with a second's grace for a phone's rounding. */
export const longestVideoMs = 15 * 60_000 + 1000

/** Analysis clips run at this many frames a second, so a frame lasts 250 ms. */
export const analysisFps = 4
const frameMs = 1000 / analysisFps

/** A still every second: every fourth frame. */
const framesPerStill = 4

/** Meta bills at least 50 frames a request; a tail shorter than that joins the part before it. */
const shortestTailMs = 50 * frameMs

/** Analysis clips are at most this long on their long edge: SAM's own cap on a mask, so its masks come back
 * at the clip's full size. Meta charges by the frame, not the pixel. */
export const analysisEdge = 1024

/** One part of a video: where it starts and ends, in milliseconds from the start of the video. */
export interface Part {
  readonly index: number
  readonly startMs: number
  readonly endMs: number
}

/** The parts of a video of `durationMs`: 30 s each, the last one taking in a tail under 12.5 s. */
export const planParts = (durationMs: number): ReadonlyArray<Part> => {
  const count = Math.ceil(Math.max(0, durationMs) / partMs)
  const parts = Array.from({ length: count }, (_, index) => ({
    index,
    startMs: index * partMs,
    endMs: Math.min(durationMs, (index + 1) * partMs),
  }))
  const last = parts.at(-1)
  const before = parts.at(-2)
  if (last === undefined || before === undefined || last.endMs - last.startMs >= shortestTailMs) return parts
  return [...parts.slice(0, -2), { ...before, endMs: last.endMs }]
}

/** The times, from the start of the video, of a part's analysis frames: one every 250 ms. */
export const frameTimes = (part: Part) =>
  Array.from({ length: Math.ceil((part.endMs - part.startMs) / frameMs) }, (_, frame) => part.startMs + frame * frameMs)

/** Whether a part's frame is also a still. */
export const isStill = (frame: number) => frame % framesPerStill === 0

/** `width` × `height` scaled to fit `edge` on the long side, never up, in even pixels as encoders need. */
export const fitWithin = (width: number, height: number, edge: number) => {
  const scale = Math.min(1, edge / Math.max(width, height))
  const even = (value: number) => Math.max(2, 2 * Math.round((value * scale) / 2))
  return { width: even(width), height: even(height) }
}
