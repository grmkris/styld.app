import { isBusy, outcomeUnknown } from '../providers/Errors.ts'
import { Effect, Schedule, Schema } from 'effect'
import { detectionsOf, type Found } from './Detections.ts'
import { frameAt } from './FrameRanking.ts'
import { readObject, storedAs, unavailable } from './Shared.ts'
import type { CaptureRow, FrameRow } from './Store.ts'
import { findMoov, metadataRanges, videoFrameCount } from './VideoContainer.ts'
import { nowDate } from '../kernel/Db.ts'
import { CaptureStore } from './Store.ts'
import { Media } from '../kernel/Media.ts'
import { Garments } from './Garments.ts'

/** Another delivery of the same capture already handed the video to Meta; this one stops. */
class TrackingClaimed extends Schema.TaggedError<TrackingClaimed>()('TrackingClaimed', {}) {}

/** The clip's frame count and the byte ranges of its metadata, read from its container in the bucket. */
const readContainer = (capture: CaptureRow) =>
  Effect.flatMap(Media, ({ bucket }) =>
    Effect.tryPromise({
      try: async () => {
        const moov = await findMoov(async (offset, length) => {
          const object = await bucket.get(capture.originalKey, { range: { offset, length } })
          return object === null ? new Uint8Array() : new Uint8Array(await object.arrayBuffer())
        }, capture.bytes)
        return moov === undefined
          ? { frameCount: undefined, metadata: [] }
          : { frameCount: videoFrameCount(moov.bytes), metadata: metadataRanges(moov.bytes, moov.offset) }
      },
      catch: unavailable,
    }),
  )

/** Hand the video to SAM once: a delivery that finds it already handed over, with no result, reports an unknown
 * outcome rather than paying again. The capture keeps the file id, so a retry hands over nothing twice. */
const handedOver = (capture: CaptureRow, frameCount: number) =>
  Effect.gen(function* () {
    if (capture.trackingStartedAt !== null) return yield* outcomeUnknown('meta-sam')
    const { metadata } = yield* readContainer(capture)
    const store = yield* CaptureStore
    if (!(yield* storedAs(store.claimTracking(capture, yield* nowDate)))) return yield* TrackingClaimed.make({})
    const garments = yield* Garments
    const fileId =
      capture.providerFileId ??
      (yield* garments
        .handOver({
          key: capture.originalKey,
          bytes: capture.bytes,
          contentType: capture.contentType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4',
          metadata,
        })
        .pipe(Effect.tapError((error) => (isBusy(error) ? storedAs(store.releaseTracking(capture)) : Effect.void))))
    yield* storedAs(store.recordFile(capture, fileId, yield* nowDate)).pipe(
      Effect.retry({ times: 2, schedule: Schedule.exponential('100 millis') }),
      Effect.tapError(() => garments.forget(fileId).pipe(Effect.ignore)),
      Effect.mapError(() => outcomeUnknown('meta-sam')),
    )
    if (!(yield* storedAs(store.handedOver(capture, fileId, frameCount)))) {
      yield* garments.forget(fileId).pipe(Effect.ignore)
      return yield* TrackingClaimed.make({})
    }
    return fileId
  })

/** Track every garment through the video and cut each from the sharpest, fullest still it shows in. */
export const processVideo = Effect.fn('Styld.Capture.processVideo')(function* (
  capture: CaptureRow,
  frames: ReadonlyArray<FrameRow>,
) {
  if (frames.length === 0) return yield* unavailable()
  const frameCount =
    capture.frameCount ??
    (yield* readContainer(capture)).frameCount ??
    Math.round(((capture.durationMs ?? 0) / 1000) * 30)
  const durationMs = capture.durationMs ?? 1
  const stills = frames.map((frame) => ({
    key: frame.objectKey,
    frame: frameAt(frame.atMs, frameCount, durationMs),
    index: frame.idx,
    atMs: frame.atMs,
    width: 0,
    height: 0,
    sharpness: frame.sharpness,
  }))
  const fileId = yield* handedOver(capture, frameCount)
  const media = yield* Media
  const garments = yield* (yield* Garments).track({
    fileId,
    stills,
    frameSize: { width: capture.width ?? 1, height: capture.height ?? 1 },
    read: (key) => readObject(key).pipe(Effect.provideService(Media, media)),
  })
  const found = yield* detectionsOf(
    capture,
    garments.map((garment) => ({ garment, sourceKey: garment.still })),
  ).pipe(Effect.mapError(() => outcomeUnknown('meta-sam')))
  return { found, route: null, provider: 'sam' } satisfies Found
})
