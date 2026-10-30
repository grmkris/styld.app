import { Effect, Fiber } from 'effect'
import { type SampledStill, sharpnessOf, stillEdge, VideoNotSampled } from './Frames.ts'

/** A minute, with a second's grace for a phone's rounding: the longest clip sent whole. */
const longestMs = 61_000

export interface SampledVideo {
  readonly durationMs: number
  readonly width: number
  readonly height: number
  readonly stills: ReadonlyArray<SampledStill>
}

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
    // Listen first: a seek to a frame already decoded can finish before a later listener is added.
    const seeked = yield* Effect.forkChild(next(video, 'seeked', 10))
    video.currentTime = atMs / 1000
    yield* Fiber.join(seeked)
    const sharpness = sharpnessOf(video, video.videoWidth, video.videoHeight)
    return { jpeg: yield* jpegOf(video), atMs, sharpness } satisfies SampledStill
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
