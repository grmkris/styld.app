import { Array, DateTime, Effect, Option, Record, Schema } from 'effect'
import { bestSightings, frameAt, type SampledStill, type TrackSighting } from './FrameRanking.ts'
import { type Parts, readObject, storedAs, unavailable } from './Parts.ts'
import { decodedPng } from './Pixels.ts'
import { CaptureConfig, type CapturePolicy } from './Policy.ts'
import { type CutPiece, detectionsOf, originalOnly, segmentedPieces } from './PhotoPipeline.ts'
import { GarmentSegmenter, PictureWork, ProviderOutcomeUnknown } from './Providers.ts'
import type { CaptureRow, FrameRow } from './Store.ts'
import { findMoov, metadataRanges, videoFrameCount } from './VideoContainer.ts'

/** At most this many pieces from one video. */
const maximumPieces = 20

/** Another delivery of the same capture already handed the video to Meta; this one stops. */
export class TrackingClaimed extends Schema.TaggedError<TrackingClaimed>()('TrackingClaimed', {}) {}

const now = Effect.map(DateTime.now, DateTime.toDateUtc)

/** The clip's frame count and the byte ranges of its metadata, read from its container in the bucket. */
const readContainer = (parts: Parts, capture: CaptureRow) =>
  Effect.tryPromise({
    try: async () => {
      const moov = await findMoov(async (offset, length) => {
        const object = await parts.bindings.bucket.get(capture.originalKey, { range: { offset, length } })
        return object === null ? new Uint8Array() : new Uint8Array(await object.arrayBuffer())
      }, capture.bytes)
      return moov === undefined
        ? { frameCount: undefined, metadata: [] }
        : { frameCount: videoFrameCount(moov.bytes), metadata: metadataRanges(moov.bytes, moov.offset) }
    },
    catch: unavailable,
  })

/** Cut each tracked garment from the best still it shows in. A still's working copies are made once,
 * however many garments it shows. */
const cutFromStills = (
  parts: Parts,
  best: ReadonlyArray<{ readonly sighting: TrackSighting; readonly still: SampledStill & { readonly key: string } }>,
  masks: ReadonlyMap<string, { readonly bounds: TrackSighting['bounds']; readonly raster: Uint8Array }>,
  frameSize: { readonly width: number; readonly height: number },
  edges: CapturePolicy['edges'],
) =>
  Effect.forEach(
    Record.toEntries(Array.groupBy(best, ({ still }) => still.key)),
    ([key, sightings]) =>
      Effect.gen(function* () {
        const bytes = yield* readObject(parts, key)
        if (Option.isNone(bytes)) return []
        const copies = yield* (yield* PictureWork).workingCopies(bytes.value)
        const picture = yield* decodedPng(copies.png)
        return sightings.flatMap(({ sighting }) => {
          const mask = masks.get(`${sighting.track}@${sighting.frame}`)
          if (mask === undefined) return []
          return segmentedPieces(
            picture,
            [{ ...mask, track: sighting.track, confidence: sighting.confidence }],
            frameSize,
            edges,
          ).map((piece): CutPiece & { readonly key: string } => ({ ...piece, key }))
        })
      }),
    { concurrency: 2 },
  ).pipe(Effect.map((pieces) => pieces.flat()))

/** Track the video at Meta once: a delivery that finds it already handed over, with no result, reports
 * an unknown outcome rather than paying again. The file at Meta is deleted once tracking settles. */
const trackOnce = (parts: Parts, capture: CaptureRow, frames: ReadonlySet<number>, frameCount: number) =>
  Effect.gen(function* () {
    if (capture.trackingStartedAt !== null) return yield* new ProviderOutcomeUnknown({ provider: 'meta-sam' })
    const segmenter = yield* GarmentSegmenter
    const { metadata } = yield* readContainer(parts, capture)
    const fileId =
      capture.providerFileId ??
      (yield* segmenter.upload({
        key: capture.originalKey,
        bytes: capture.bytes,
        contentType: capture.contentType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4',
        metadata,
      }))
    yield* storedAs(parts.store.updateCapture(capture.id, { providerFileId: fileId, frameCount }))
    if (!(yield* storedAs(parts.store.claimTracking(capture.id, yield* now)))) return yield* TrackingClaimed.make({})
    return yield* segmenter.track(fileId, 'clothing', frames).pipe(Effect.ensuring(segmenter.forget(fileId)))
  })

/** Track every garment through the video and cut each from the sharpest, fullest still it shows in. */
export const processVideo = Effect.fn('Styld.Capture.processVideo')(function* (
  parts: Parts,
  capture: CaptureRow,
  frames: ReadonlyArray<FrameRow>,
) {
  const policy = yield* CaptureConfig
  const sharpest = frames.toSorted((a, b) => sum(b.sharpness) - sum(a.sharpness))[0]
  if (sharpest === undefined) return yield* unavailable()
  if (policy.providers === 'off')
    return { found: [yield* originalOnly(parts, capture, sharpest.objectKey)], route: null, provider: 'off' }
  const frameCount =
    capture.frameCount ??
    (yield* readContainer(parts, capture)).frameCount ??
    Math.round(((capture.durationMs ?? 0) / 1000) * 30)
  const durationMs = capture.durationMs ?? 1
  const stills = new Map(
    frames.map((frame) => [
      frameAt(frame.atMs, frameCount, durationMs),
      { index: frame.idx, atMs: frame.atMs, width: 0, height: 0, sharpness: frame.sharpness, key: frame.objectKey },
    ]),
  )
  const tracked = yield* trackOnce(parts, capture, new Set(stills.keys()), frameCount)
  const frameSize = tracked.frameSize ?? { width: capture.width ?? 1, height: capture.height ?? 1 }
  const sized = new Map([...stills].map(([frame, still]) => [frame, { ...still, ...frameSize }]))
  const sightings = tracked.found.map((found) => ({
    track: found.track,
    frame: found.frame,
    bounds: found.bounds,
    area: found.raster.reduce((total, value) => total + (value === 0 ? 0 : 1), 0),
    confidence: found.confidence,
  }))
  const masks = new Map(tracked.found.map((found) => [`${found.track}@${found.frame}`, found]))
  const best = bestSightings(sightings, sized)
    .toSorted((a, b) => b.sighting.area - a.sighting.area)
    .slice(0, maximumPieces)
  const pieces = yield* cutFromStills(parts, best, masks, frameSize, policy.edges)
  const found = yield* Effect.forEach(pieces, (piece) => detectionsOf(parts, capture, piece.key, [piece], () => true), {
    concurrency: 4,
  })
  return { found: found.flat(), route: null, provider: 'sam' }
})

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)
