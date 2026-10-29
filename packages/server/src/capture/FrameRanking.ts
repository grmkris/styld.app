import type { Box } from './Pixels.ts'

/** A still the browser sampled from the video: when, its size, and how sharp each of its 8×8 tiles is. */
export interface SampledStill {
  readonly index: number
  readonly atMs: number
  readonly width: number
  readonly height: number
  /** 64 relative sharpness values, row by row, each from 0 to 1. */
  readonly sharpness: ReadonlyArray<number>
}

/** One garment as SAM saw it in one frame. */
export interface TrackSighting {
  readonly track: string
  readonly frame: number
  readonly bounds: Box
  readonly area: number
  readonly confidence: number
}

/** The SAM frame shown at `atMs`, given the frames SAM saw over the clip's duration. */
export const frameAt = (atMs: number, frames: number, durationMs: number): number =>
  Math.min(frames - 1, Math.max(0, Math.round((atMs / durationMs) * frames)))

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

const boxArea = (box: Box) => (box.right - box.left) * (box.bottom - box.top)

/** How sharp the still is under `box`: the mean of the tiles the box touches. */
export const sharpnessIn = (still: SampledStill, box: Box): number => {
  const columns = Math.floor((box.left / still.width) * 8)
  const lastColumn = Math.min(7, Math.floor(((box.right - 1) / still.width) * 8))
  const rows = Math.floor((box.top / still.height) * 8)
  const lastRow = Math.min(7, Math.floor(((box.bottom - 1) / still.height) * 8))
  let sum = 0
  let count = 0
  for (let row = Math.max(0, rows); row <= lastRow; row++)
    for (let column = Math.max(0, columns); column <= lastColumn; column++) {
      sum += still.sharpness[row * 8 + column] ?? 0
      count++
    }
  return count === 0 ? 0 : sum / count
}

/** How good a sighting is, from the weights of the owner's Meta spike (`tools/wardrobe-rail/capture.py`):
 * sharpness and visible area, little contact with other garments, and a penalty for touching the frame
 * edge, which usually means the garment is cut off. */
const scoreOf = (
  sighting: TrackSighting,
  still: SampledStill,
  largest: number,
  sightings: ReadonlyArray<TrackSighting>,
) => {
  const others = sightings.filter(({ frame, track }) => frame === sighting.frame && track !== sighting.track)
  const overlapping = others.reduce((sum, other) => sum + overlap(sighting.bounds, other.bounds), 0)
  const contact = Math.min(1, overlapping / boxArea(sighting.bounds))
  const { bounds } = sighting
  const nearX = bounds.left <= 1 || bounds.right >= still.width - 1
  const nearY = bounds.top <= 1 || bounds.bottom >= still.height - 1
  const edge = nearX || nearY ? 0.5 : 0
  return (
    0.35 * sharpnessIn(still, bounds) +
    0.35 * (sighting.area / largest) +
    0.3 * (1 - contact) -
    edge +
    0.01 * sighting.confidence
  )
}

/** The best sighting of each track and the still it sits in. */
export const bestSightings = <Still extends SampledStill>(
  sightings: ReadonlyArray<TrackSighting>,
  stills: ReadonlyMap<number, Still>,
): ReadonlyArray<{ readonly sighting: TrackSighting; readonly still: Still }> => {
  const byTrack = new Map<string, Array<TrackSighting>>()
  for (const sighting of sightings) byTrack.set(sighting.track, [...(byTrack.get(sighting.track) ?? []), sighting])
  const best: Array<{ readonly sighting: TrackSighting; readonly still: Still }> = []
  for (const candidates of byTrack.values()) {
    const largest = Math.max(1, ...candidates.map(({ area }) => area))
    const scored = candidates.flatMap((sighting) => {
      const still = stills.get(sighting.frame)
      return still === undefined ? [] : [{ sighting, still, score: scoreOf(sighting, still, largest, sightings) }]
    })
    const winner = scored.reduce<(typeof scored)[number] | undefined>(
      (top, entry) => (top === undefined || entry.score > top.score ? entry : top),
      undefined,
    )
    if (winner !== undefined) best.push({ sighting: winner.sighting, still: winner.still })
  }
  return best
}
