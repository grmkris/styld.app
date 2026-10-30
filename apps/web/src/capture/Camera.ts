import { Clock, Effect, Queue, Schedule, Stream } from 'effect'
import { settlingOf, startWatch, watchFrame } from './Stillness.ts'

/** What the camera reports: it started, it could not, how close the picture is to settling, or a photo
 * was taken (by holding still, by staying still a while longer, or by a tap on the shutter) with a small
 * copy for the garment check. */
export type CameraEvent =
  | { readonly kind: 'started' }
  | { readonly kind: 'failed'; readonly reason: 'denied' | 'unavailable' }
  | { readonly kind: 'settling'; readonly level: number }
  | { readonly kind: 'settled' | 'again' | 'tapped'; readonly check: File; readonly still: File }

/** Grey frames for the stillness watch are this wide. */
const watchWidth = 64
/** The garment check sees at most this much of the photo's long edge. */
const checkEdge = 512
/** A photo is at most this long on its long edge. */
const stillEdge = 2048

const failed = (reason: 'denied' | 'unavailable'): CameraEvent => ({ kind: 'failed', reason })

const grey = (video: HTMLVideoElement, canvas: OffscreenCanvas) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return new Uint8Array()
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const frame = new Uint8Array(canvas.width * canvas.height)
  for (let at = 0; at < frame.length; at++)
    frame[at] = ((data[at * 4] ?? 0) * 77 + (data[at * 4 + 1] ?? 0) * 150 + (data[at * 4 + 2] ?? 0) * 29) >> 8
  return frame
}

/** The camera's current picture as a JPEG file, at most `edge` on its long edge, unmirrored. */
const jpeg = (video: HTMLVideoElement, edge: number, name: string) =>
  Effect.tryPromise({
    try: async () => {
      const scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight))
      const canvas = new OffscreenCanvas(Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale))
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
      return new File([blob], name, { type: 'image/jpeg' })
    },
    catch: () => failed('unavailable'),
  })

const shot = (video: HTMLVideoElement, kind: 'settled' | 'again' | 'tapped') =>
  Effect.gen(function* () {
    const stamp = (yield* Clock.currentTimeMillis).toString(36)
    const check = yield* jpeg(video, checkEdge, `check-${stamp}.jpg`)
    const still = yield* jpeg(video, stillEdge, `camera-${stamp}.jpg`)
    return { kind, check, still } satisfies CameraEvent
  })

const openCamera = (facing: 'user' | 'environment') =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        }),
      catch: (error) =>
        failed(error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'unavailable'),
    }),
    (stream) => Effect.sync(() => stream.getTracks().forEach((track) => track.stop())),
  )

/** Run the camera inside `host` (which holds a `<video>`) until the page lets it go: report how close the
 * scene is to settling, each time it settles after moving or stays settled a while longer, and each tap
 * on an element marked `data-shutter` (the picture, and the shutter button, which a key presses too). */
export const watchCamera = (host: Element, facing: 'user' | 'environment') =>
  Stream.callback<CameraEvent>((queue) =>
    Effect.gen(function* () {
      const video = host.querySelector('video')
      if (video === null) return yield* Effect.fail(failed('unavailable'))
      const stream = yield* openCamera(facing)
      video.srcObject = stream
      yield* Effect.tryPromise({ try: () => video.play(), catch: () => failed('unavailable') })
      Queue.offerUnsafe(queue, { kind: 'started' })
      // A tap is answered on the next tick, so every photo is taken inside this stream's scope.
      let tapped = false
      const tap = (event: Event) => {
        if (event.target instanceof Element && event.target.closest('[data-shutter]') !== null) tapped = true
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => host.addEventListener('click', tap)),
        () =>
          Effect.sync(() => {
            host.removeEventListener('click', tap)
            video.srcObject = null
          }),
      )
      const canvas = new OffscreenCanvas(
        watchWidth,
        Math.max(1, Math.round((watchWidth * video.videoHeight) / Math.max(1, video.videoWidth))),
      )
      let watch = startWatch
      let level = 0
      const tick = Effect.gen(function* () {
        const next = watchFrame(watch, grey(video, canvas))
        watch = next.watch
        // Only a change is reported: a few a second while the picture calms down.
        const settling = settlingOf(next.watch)
        if (settling !== level) Queue.offerUnsafe(queue, { kind: 'settling', level: settling })
        level = settling
        const kind = tapped ? 'tapped' : next.settle
        tapped = false
        if (kind !== undefined) Queue.offerUnsafe(queue, yield* shot(video, kind))
      })
      return yield* tick.pipe(Effect.repeat(Schedule.spaced('200 millis')), Effect.andThen(Effect.never))
    }).pipe(Effect.catch((event: CameraEvent) => Effect.sync(() => Queue.offerUnsafe(queue, event)))),
  )
