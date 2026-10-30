import {
  BlobSource,
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Input,
  type InputVideoTrack,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  VideoSampleSink,
} from 'mediabunny'
import { Effect, Exit, Stream } from 'effect'
import { type SampledStill, sharpnessOf, stillEdge, VideoNotSampled } from './Frames.ts'
import {
  analysisEdge,
  analysisFps,
  fitWithin,
  frameTimes,
  isStill,
  longestVideoMs,
  type Part,
  planParts,
} from './PartPlan.ts'

/** How a video goes to Styld: cut into parts here, or sent whole when this browser cannot read it frame by
 * frame (60 s at most, then sampled by `Sampler.ts`). */
export interface VideoPlan {
  readonly route: 'parts' | 'whole'
  readonly durationMs: number
  readonly parts: ReadonlyArray<Part>
}

/** One part, ready to send: its analysis clip and its stills. */
export interface CutPart {
  readonly clip: Blob
  readonly width: number
  readonly height: number
  readonly durationMs: number
  readonly stills: ReadonlyArray<SampledStill>
}

/** The longest video sent whole, where this browser cannot cut it. */
const longestWholeMs = 61_000

/** About 1 Mbit/s: plenty for 720 px at 4 frames a second, and a 30-second part stays near 4 MB. */
const analysisBitrate = 1_000_000

const unreadable = () => VideoNotSampled.make({ reason: 'unreadable' })

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: unreadable })

/** The video file, read lazily from the device: Mediabunny keeps at most 8 MiB of it in memory. */
const opened = (file: Blob) =>
  Effect.acquireRelease(
    Effect.sync(() => new Input({ formats: [MP4, QTFF], source: new BlobSource(file) })),
    (input) => Effect.sync(() => input.dispose()),
  )

const videoTrack = (input: Input) =>
  Effect.flatMap(
    attempt(() => input.getPrimaryVideoTrack()),
    (track) => (track === null ? Effect.fail(unreadable()) : Effect.succeed(track)),
  )

/** The track's upright size, scaled to fit `edge`. */
const sizeOf = (track: InputVideoTrack, edge: number) =>
  Effect.map(
    Effect.all([attempt(() => track.getDisplayWidth()), attempt(() => track.getDisplayHeight())]),
    ([width, height]) => fitWithin(width, height, edge),
  )

/** Whether this browser can decode the video and encode H.264 analysis clips. */
const canCut = (track: InputVideoTrack) =>
  Effect.gen(function* () {
    if (typeof VideoEncoder !== 'function') return false
    if (!(yield* attempt(() => track.canDecode()))) return false
    const size = yield* sizeOf(track, analysisEdge)
    return yield* attempt(() => canEncodeVideo('avc', { ...size, frameRate: analysisFps, bitrate: analysisBitrate }))
  })

/** How long the video is and how it goes to Styld. A file this browser cannot open at all goes whole, and
 * the sampler decides whether it can play it. */
export const inspectVideo = (file: Blob) =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* opened(file)
      const track = yield* videoTrack(input)
      const start = yield* attempt(() => track.getFirstTimestamp())
      const end = yield* attempt(() => track.computeDuration())
      const durationMs = Math.round((end - start) * 1000)
      if (durationMs > longestVideoMs) return yield* VideoNotSampled.make({ reason: 'tooLong' })
      const parts = planParts(durationMs)
      if (parts.length > 0 && (yield* canCut(track))) return { route: 'parts', durationMs, parts } satisfies VideoPlan
      if (durationMs <= longestWholeMs) return { route: 'whole', durationMs, parts: [] } satisfies VideoPlan
      return yield* unreadable()
    }),
  ).pipe(
    Effect.catchIf(
      (error) => error.reason === 'unreadable',
      () => Effect.succeed({ route: 'whole', durationMs: 0, parts: [] } satisfies VideoPlan),
    ),
  )

/** A 2D context for a canvas of `size`. */
const drawing = (size: { readonly width: number; readonly height: number }) => {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  return context === null ? Effect.fail(unreadable()) : Effect.succeed({ canvas, context })
}

/** The H.264 analysis clip being written: a steady 4 frames a second, no audio. Cancelled unless finished. */
const clipWriter = (canvas: OffscreenCanvas) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const source = new CanvasSource(canvas, { codec: 'avc', bitrate: analysisBitrate, keyFrameInterval: 2 })
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
      output.addVideoTrack(source, { frameRate: analysisFps })
      yield* attempt(() => output.start())
      return { source, output }
    }),
    ({ output }, exit) =>
      Exit.isSuccess(exit) ? Effect.void : Effect.promise(() => output.cancel().catch(() => undefined)),
  )

/** Cut one part of a video: its frames drawn upright into a 720 px analysis clip at 4 frames a second, and
 * every fourth frame kept as a 1280 px still with its sharpness. Only this part is ever held in memory. */
export const cutPart = (file: Blob, part: Part) =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* opened(file)
      const track = yield* videoTrack(input)
      const start = yield* attempt(() => track.getFirstTimestamp())
      const clip = yield* drawing(yield* sizeOf(track, analysisEdge))
      const still = yield* drawing(yield* sizeOf(track, stillEdge))
      const { source, output } = yield* clipWriter(clip.canvas)
      const times = frameTimes(part)
      const stills: Array<SampledStill> = []
      const samples = new VideoSampleSink(track).samplesAtTimestamps(times.map((atMs) => start + atMs / 1000))
      yield* Stream.fromAsyncIterable(samples, unreadable).pipe(
        Stream.zipWithIndex,
        Stream.runForEach(([sample, frame]) =>
          Effect.gen(function* () {
            // No frame yet at this time (before the first one): the canvas keeps the last, so the rate holds.
            if (sample !== null)
              yield* Effect.try({
                try: () => {
                  sample.draw(clip.context, 0, 0, clip.canvas.width, clip.canvas.height)
                  if (isStill(frame)) sample.draw(still.context, 0, 0, still.canvas.width, still.canvas.height)
                },
                catch: unreadable,
              }).pipe(Effect.ensuring(Effect.sync(() => sample.close())))
            yield* attempt(() => source.add(frame / analysisFps, 1 / analysisFps))
            if (isStill(frame) && sample !== null) {
              const jpeg = yield* attempt(() => still.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 }))
              const sharpness = sharpnessOf(still.canvas, still.canvas.width, still.canvas.height)
              stills.push({ jpeg, atMs: frame * (1000 / analysisFps), sharpness })
            }
          }),
        ),
      )
      source.close()
      yield* attempt(() => output.finalize())
      const buffer = output.target.buffer
      if (buffer === null || stills.length === 0) return yield* unreadable()
      return {
        clip: new Blob([buffer], { type: 'video/mp4' }),
        width: clip.canvas.width,
        height: clip.canvas.height,
        durationMs: times.length * (1000 / analysisFps),
        stills,
      } satisfies CutPart
    }),
  )
