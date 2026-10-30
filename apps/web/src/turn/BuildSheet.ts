import {
  armsRow,
  clipAbove,
  decodePng,
  keyOut,
  packSheet,
  pickedFrames,
  type Rgba,
  sheetLayout,
  shrink,
  silhouetteWidth,
  turnEnd,
} from '@styld/imaging'
import { Effect, Schema, Stream } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { type InputVideoTrack, VideoSampleSink } from 'mediabunny'
import { drawing, opened, videoTrack } from '../capture/VideoParts.ts'

/** The turn's video could not be cut into a sheet here: unreadable, or a key that removed a whole frame. */
export class SheetNotBuilt extends Schema.TaggedError<SheetNotBuilt>()('SheetNotBuilt', {}) {}

const failed = () => SheetNotBuilt.make({})

// Frames are read at three eighths of the turn's 720 by 1280 canvas, enough for 288 by 384 cells, and probed at an
// eighth to find where the turn stops.
const frameSize = { width: 270, height: 480 }
const probeSize = { width: 90, height: 160 }

type Canvas = Effect.Success<ReturnType<typeof drawing>>

const pixelsOf = ({ context, canvas }: Canvas): Rgba => {
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(image.data.buffer) }
}

/** The key colour the turn was made on: green unless its first frame's corner leans magenta. */
const keyOf = (frame: Rgba) =>
  (frame.data[1] ?? 0) > Math.max(frame.data[0] ?? 0, frame.data[2] ?? 0) ? ('green' as const) : ('magenta' as const)

/** Every frame of the turn, small and keyed: when each is, and how wide its silhouette is. */
const probe = (track: InputVideoTrack) =>
  Effect.gen(function* () {
    const canvas = yield* drawing(probeSize)
    const seen: Array<{ readonly timestamp: number; readonly width: number }> = []
    let key: 'green' | 'magenta' | undefined
    yield* Stream.fromAsyncIterable(new VideoSampleSink(track).samples(), failed).pipe(
      Stream.runForEach((sample) =>
        Effect.sync(() => {
          sample.draw(canvas.context, 0, 0, probeSize.width, probeSize.height)
          const pixels = pixelsOf(canvas)
          key ??= keyOf(pixels)
          seen.push({ timestamp: sample.timestamp, width: silhouetteWidth(keyOut(pixels, key)) })
          sample.close()
        }),
      ),
    )
    if (key === undefined || seen.length < sheetLayout.frames) return yield* failed()
    return { key, seen }
  })

/** The frames at `timestamps`, at half size and keyed. */
const framesAt = (track: InputVideoTrack, timestamps: ReadonlyArray<number>, key: 'green' | 'magenta') =>
  Effect.gen(function* () {
    const canvas = yield* drawing(frameSize)
    const frames: Array<Rgba> = []
    yield* Stream.fromAsyncIterable(new VideoSampleSink(track).samplesAtTimestamps(timestamps), failed).pipe(
      Stream.runForEach((sample) =>
        Effect.gen(function* () {
          if (sample === null) return yield* failed()
          sample.draw(canvas.context, 0, 0, frameSize.width, frameSize.height)
          sample.close()
          frames.push(keyOut(pixelsOf(canvas), key))
        }),
      ),
    )
    return frames
  })

/** A sheet as PNG bytes, encoded by the browser. */
const pngOf = (sheet: Rgba) =>
  Effect.gen(function* () {
    const canvas = yield* drawing(sheet)
    canvas.context.putImageData(new ImageData(new Uint8ClampedArray(sheet.data), sheet.width, sheet.height), 0, 0)
    const blob = yield* Effect.tryPromise({
      try: () => canvas.canvas.convertToBlob({ type: 'image/png' }),
      catch: failed,
    })
    return new Uint8Array(yield* Effect.tryPromise({ try: () => blob.arrayBuffer(), catch: failed }))
  })

/** A turn's frame sheet, cut here from its video: 29 frames from the start of the turn to where it stops, then the
 * clean front it ends on, each keyed with the hook cut above the hanger's arms, packed about the hanger's apex. */
export const buildSheet = (video: Blob, front: Uint8Array) =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* opened(video)
      const track = yield* videoTrack(input)
      const { key, seen } = yield* probe(track)
      const end = turnEnd(seen.map(({ width }) => width))
      const timestamps = pickedFrames(end, sheetLayout.frames)
        .slice(0, -1)
        .map((index) => seen[index]?.timestamp ?? 0)
      const frames = yield* framesAt(track, timestamps, key)
      const last = shrink(yield* Effect.try({ try: () => decodePng(front), catch: failed }), frameSize.height)
      const arms = armsRow(last)
      const sheet = packSheet([...frames, last].map((frame) => clipAbove(frame, arms)))
      if (sheet === undefined) return yield* failed()
      return { layout: sheetLayout, sheet: Base64.encode(yield* pngOf(sheet)) }
    }),
  ).pipe(Effect.mapError(failed))
