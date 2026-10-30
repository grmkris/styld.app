import { Schema } from 'effect'

/** The browser could not read the video, or it runs longer than Styld takes. */
export class VideoNotSampled extends Schema.TaggedError<VideoNotSampled>()('VideoNotSampled', {
  reason: Schema.Literals(['unreadable', 'tooLong']),
}) {}

/** One still of a video, as the server receives it beside the clip. */
export interface SampledStill {
  readonly jpeg: Blob
  /** Its time from the start of the clip it goes with. */
  readonly atMs: number
  /** 64 relative sharpness values, 8×8 tiles row by row, each from 0 to 1. */
  readonly sharpness: ReadonlyArray<number>
}

/** Stills are at most this long on their long edge: enough for a garment's cut-out, small to upload. */
export const stillEdge = 1280

/** Sharpness is measured on a small grey copy, this wide. */
const measureWidth = 128
const tiles = 8

/** Relative sharpness of each tile: the mean absolute Laplacian of its grey pixels, squashed into 0–1.
 * @internal Exported for its tests. */
export const tileSharpness = (grey: Uint8ClampedArray | Uint8Array, width: number, height: number) => {
  const sums = Array.from({ length: tiles * tiles }, () => 0)
  const counts = Array.from({ length: tiles * tiles }, () => 0)
  for (let row = 1; row < height - 1; row++)
    for (let column = 1; column < width - 1; column++) {
      const at = row * width + column
      const laplacian =
        4 * (grey[at] ?? 0) -
        (grey[at - 1] ?? 0) -
        (grey[at + 1] ?? 0) -
        (grey[at - width] ?? 0) -
        (grey[at + width] ?? 0)
      const tile =
        Math.min(tiles - 1, Math.floor((row * tiles) / height)) * tiles + Math.floor((column * tiles) / width)
      sums[tile] = (sums[tile] ?? 0) + Math.abs(laplacian)
      counts[tile] = (counts[tile] ?? 0) + 1
    }
  return sums.map((sum, tile) => {
    const mean = sum / Math.max(1, counts[tile] ?? 0)
    return mean / (mean + 10)
  })
}

/** The tile sharpness of a picture, measured on a small grey copy of it. */
export const sharpnessOf = (picture: CanvasImageSource, width: number, height: number) => {
  const measured = {
    width: measureWidth,
    height: Math.max(tiles, Math.round((measureWidth * height) / Math.max(1, width))),
  }
  const canvas = new OffscreenCanvas(measured.width, measured.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return Array.from({ length: tiles * tiles }, () => 0)
  context.drawImage(picture, 0, 0, measured.width, measured.height)
  const { data } = context.getImageData(0, 0, measured.width, measured.height)
  const grey = new Uint8Array(measured.width * measured.height)
  for (let at = 0; at < grey.length; at++)
    grey[at] = ((data[at * 4] ?? 0) * 77 + (data[at * 4 + 1] ?? 0) * 150 + (data[at * 4 + 2] ?? 0) * 29) >> 8
  return tileSharpness(grey, measured.width, measured.height)
}
