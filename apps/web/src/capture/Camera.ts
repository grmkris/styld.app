import { Clock, Deferred, Effect, Option, Queue, Schedule, type Scope, Stream } from 'effect'
import { settlingOf, startWatch, watchFrame } from './Stillness.ts'

/** Why the camera could not start or keep going: the person refused it, or there is none to use. */
export interface CameraFailure {
  readonly kind: 'failed'
  readonly reason: 'denied' | 'unavailable'
}

/** A photo, with a small copy for the garment check. */
export interface Pictures {
  readonly check: File
  readonly still: File
}

/** What watching the picture reports: how close it is to settling, a change (and whether the lens is covered), and a
 * photo each time it settles after moving or stays settled a while longer. */
export type WatchEvent =
  | { readonly kind: 'settling'; readonly level: number }
  | { readonly kind: 'changed'; readonly blocked: boolean }
  | ({ readonly kind: 'settled' | 'again' } & Pictures)

/** The live camera the page holds while its camera screen is up (HeldCamera's ManagedResource). */
export interface CameraHandle {
  /** Play the camera in the page's `<video>`; the picture is read from it from then on. */
  readonly show: (video: HTMLVideoElement) => Effect.Effect<void, CameraFailure>
  /** The picture, watched frame by frame once it shows. */
  readonly watch: Stream.Stream<WatchEvent, CameraFailure>
  /** A photo on the next frame, for the shutter; none if the camera goes first. */
  readonly tap: Effect.Effect<Option.Option<Pictures>>
  /** A photo on the next frame if the picture is still and the lens clear, after the countdown; none otherwise. */
  readonly afterCountdown: Effect.Effect<Option.Option<Pictures>>
}

/** Grey frames for the stillness watch are this wide. */
const watchWidth = 64
/** The garment check sees at most this much of the photo's long edge. */
const checkEdge = 512
/** A photo is at most this long on its long edge. */
const stillEdge = 2048

const failed = (reason: 'denied' | 'unavailable'): CameraFailure => ({ kind: 'failed', reason })

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

const shot = (video: HTMLVideoElement) =>
  Effect.gen(function* () {
    const stamp = (yield* Clock.currentTimeMillis).toString(36)
    const check = yield* jpeg(video, checkEdge, `check-${stamp}.jpg`)
    const still = yield* jpeg(video, stillEdge, `camera-${stamp}.jpg`)
    return { check, still } satisfies Pictures
  })

const mediaStream = (facing: 'user' | 'environment') =>
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

/** The photos asked for, each answered on the watch's next tick, so every photo is taken inside the watch; and the
 * page's `<video>` the camera plays in, let go with it. */
interface Asked {
  tapped: Deferred.Deferred<Option.Option<Pictures>> | undefined
  counted: Deferred.Deferred<Option.Option<Pictures>> | undefined
  video: HTMLVideoElement | undefined
}

/** The photos asked for, answered on this frame: the one after the countdown only while the picture is `still` and the
 * lens clear (a tap at the same moment gives way to it), else a tap's; the rest with none. Whether one was taken, and
 * the watch starts over from this frame. */
const answered = (video: HTMLVideoElement, asked: Asked, still: boolean) =>
  Effect.gen(function* () {
    const { tapped, counted } = asked
    asked.tapped = undefined
    asked.counted = undefined
    const counts = counted !== undefined && still
    const taking = counts ? counted : tapped
    const missed = counts ? tapped : counted
    if (missed !== undefined) yield* Deferred.succeed(missed, Option.none())
    if (taking === undefined) return false
    yield* Deferred.succeed(taking, Option.some(yield* shot(video)))
    return true
  })

/** Each tick reads a grey frame: a change or a settling level is reported when it moves, a photo asked for is taken
 * (one after the countdown only while the picture is still and the lens clear), and a settled picture is reported with
 * its photo. */
const watchLoop = Effect.fnUntraced(function* (
  video: HTMLVideoElement,
  queue: Queue.Enqueue<WatchEvent, CameraFailure>,
  asked: Asked,
) {
  const canvas = new OffscreenCanvas(
    watchWidth,
    Math.max(1, Math.round((watchWidth * video.videoHeight) / Math.max(1, video.videoWidth))),
  )
  let watch = startWatch
  let level = 0
  let blocked = false
  const tick = Effect.gen(function* () {
    const frame = grey(video, canvas)
    const next = watchFrame(watch, frame)
    watch = next.watch
    if (next.changed && (next.usable || !blocked)) Queue.offerUnsafe(queue, { kind: 'changed', blocked: !next.usable })
    blocked = !next.usable
    // Only a change is reported: a few a second while the picture calms down.
    const settling = settlingOf(next.watch)
    if (settling !== level) Queue.offerUnsafe(queue, { kind: 'settling', level: settling })
    level = settling
    if (yield* answered(video, asked, next.usable && !next.changed)) watch = { ...startWatch, previous: frame }
    else if (next.settle !== undefined) Queue.offerUnsafe(queue, { kind: next.settle, ...(yield* shot(video)) })
  })
  return yield* tick.pipe(Effect.repeat(Schedule.spaced('200 millis')), Effect.andThen(Effect.never))
})

const watchFrames = (video: HTMLVideoElement, asked: Asked) =>
  Stream.callback<WatchEvent, CameraFailure>((queue) =>
    watchLoop(video, queue, asked).pipe(Effect.catch((failure: CameraFailure) => Queue.fail(queue, failure))),
  )

/** Ask the watch for a photo on its next tick; a photo already asked for of the same kind gives way to this one. */
const ask = (asked: Asked, kind: 'tapped' | 'counted') =>
  Effect.gen(function* () {
    const answer = yield* Deferred.make<Option.Option<Pictures>>()
    const earlier = asked[kind]
    if (earlier !== undefined) yield* Deferred.succeed(earlier, Option.none())
    asked[kind] = answer
    return yield* Deferred.await(answer)
  })

/** Open the camera facing `facing` for as long as the scope lasts; the page shows it in its `<video>`. */
export const openCamera = (facing: 'user' | 'environment'): Effect.Effect<CameraHandle, CameraFailure, Scope.Scope> =>
  Effect.gen(function* () {
    const stream = yield* mediaStream(facing)
    const shown = yield* Deferred.make<HTMLVideoElement>()
    const asked: Asked = { tapped: undefined, counted: undefined, video: undefined }
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        // Photos still asked for when the camera goes are answered with none.
        for (const answer of [asked.tapped, asked.counted])
          if (answer !== undefined) yield* Deferred.succeed(answer, Option.none())
        if (asked.video !== undefined) asked.video.srcObject = null
      }),
    )
    return {
      show: (video) =>
        Effect.gen(function* () {
          video.srcObject = stream
          asked.video = video
          yield* Effect.tryPromise({ try: () => video.play(), catch: () => failed('unavailable') })
          yield* Deferred.succeed(shown, video)
        }),
      watch: Stream.unwrap(Effect.map(Deferred.await(shown), (video) => watchFrames(video, asked))),
      tap: ask(asked, 'tapped'),
      afterCountdown: ask(asked, 'counted'),
    }
  })
