import { Effect, Schema } from 'effect'

/** The browser could not play the video, or it runs longer than a minute. */
export class VideoNotSampled extends Schema.TaggedError<VideoNotSampled>()('VideoNotSampled', {
  reason: Schema.Literals(['unreadable', 'tooLong']),
}) {}

/** One still of the video, as the server receives it beside the clip. */
export interface SampledStill {
  readonly jpeg: Blob
  readonly atMs: number
  /** 64 relative sharpness values, 8×8 tiles row by row, each from 0 to 1. */
  readonly sharpness: ReadonlyArray<number>
}

export interface SampledVideo {
  readonly durationMs: number
  readonly width: number
  readonly height: number
  readonly stills: ReadonlyArray<SampledStill>
}

/** A minute, with a second's grace for a phone's rounding. */
const longestMs = 61_000
/** Stills are at most this long on their long edge: enough for a garment's cut-out, small to upload. */
const stillEdge = 1280
/** Sharpness is measured on a small grey copy, this wide. */
const measureWidth = 128
const tiles = 8

const unreadable = () => VideoNotSampled.make({ reason: 'unreadable' })

/** Wait for one event of `video`, failing on its `error` and after `seconds`. */
const next = (video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', seconds: number) =>
  Effect.callback<void, VideoNotSampled>((resume) => {
    const done = () => resume(Effect.void)
    const failed = () => resume(Effect.fail(unreadable()))
    video.addEventListener(event, done, { once: true })
    video.addEventListener('error', failed, { once: true })
    return Effect.sync(() => {
      video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
    })
  }).pipe(Effect.timeoutOrElse({ duration: `${seconds} seconds`, orElse: () => Effect.fail(unreadable()) }))

/** Every half second of a clip up to 30 s, every second of a longer one. */
export const stillTimes = (durationMs: number) => {
  const step = durationMs <= 30_000 ? 500 : 1000
  return Array.from({ length: Math.max(1, Math.floor((durationMs - 1) / step) + 1) }, (_, index) => index * step)
}

/** Relative sharpness of each tile: the mean absolute Laplacian of its grey pixels, squashed into 0–1. */
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

/** The grey values of a small copy of the current frame. */
const greyOf = (video: HTMLVideoElement) => {
  const width = measureWidth
  const height = Math.max(tiles, Math.round((measureWidth * video.videoHeight) / video.videoWidth))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return { grey: new Uint8Array(width * height), width, height }
  context.drawImage(video, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  const grey = new Uint8Array(width * height)
  for (let at = 0; at < grey.length; at++)
    grey[at] = ((data[at * 4] ?? 0) * 77 + (data[at * 4 + 1] ?? 0) * 150 + (data[at * 4 + 2] ?? 0) * 29) >> 8
  return { grey, width, height }
}

/** The current frame as a JPEG, at most `stillEdge` on its long edge. */
const jpegOf = (video: HTMLVideoElement) =>
  Effect.tryPromise({
    try: () => {
      const scale = Math.min(1, stillEdge / Math.max(video.videoWidth, video.videoHeight))
      const canvas = new OffscreenCanvas(Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale))
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    },
    catch: unreadable,
  })

const still = (video: HTMLVideoElement, atMs: number) =>
  Effect.gen(function* () {
    video.currentTime = atMs / 1000
    yield* next(video, 'seeked', 10)
    const { grey, width, height } = greyOf(video)
    return { jpeg: yield* jpegOf(video), atMs, sharpness: tileSharpness(grey, width, height) }
  })

/** Stills of a video file, sampled in the browser: the server tracks garments through the clip and cuts
 * each from its best still. The video never leaves the page until the person has chosen it. */
export const sampleVideo = (file: Blob) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      video.src = URL.createObjectURL(file)
      return video
    }),
    (video) =>
      Effect.gen(function* () {
        yield* next(video, 'loadedmetadata', 20)
        const durationMs = Math.round(video.duration * 1000)
        if (!Number.isFinite(durationMs) || video.videoWidth === 0) return yield* unreadable()
        if (durationMs > longestMs) return yield* VideoNotSampled.make({ reason: 'tooLong' })
        const stills = yield* Effect.forEach(stillTimes(durationMs), (atMs) => still(video, atMs))
        return { durationMs, width: video.videoWidth, height: video.videoHeight, stills } satisfies SampledVideo
      }),
    (video) =>
      Effect.sync(() => {
        URL.revokeObjectURL(video.src)
        video.removeAttribute('src')
        video.load()
      }),
  )
