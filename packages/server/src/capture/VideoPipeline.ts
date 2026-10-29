import { Effect, Option } from 'effect'
import { bestSightings, frameAt, type SampledStill, type TrackSighting } from './FrameRanking.ts'
import { type Parts, readObject, storedAs, unavailable } from './Parts.ts'
import { decodePng, fitMask } from './Pixels.ts'
import { CaptureConfig } from './Policy.ts'
import { type CutPiece, detectionsOf, originalOnly, segmentedPieces } from './PhotoPipeline.ts'
import { GarmentSegmenter, PictureWork } from './Providers.ts'
import type { CaptureRow, FrameRow } from './Store.ts'
import { readMoov, videoFrameCount } from './VideoContainer.ts'

/** At most this many pieces from one video. */
const maximumPieces = 20

/** The clip's frame count, read from its container in the bucket. */
const countFrames = (parts: Parts, capture: CaptureRow) =>
  Effect.tryPromise({
    try: async () => {
      const moov = await readMoov(async (offset, length) => {
        const object = await parts.bindings.bucket.get(capture.originalKey, { range: { offset, length } })
        return object === null ? new Uint8Array() : new Uint8Array(await object.arrayBuffer())
      }, capture.bytes)
      return moov === undefined ? undefined : videoFrameCount(moov)
    },
    catch: unavailable,
  })

/** Cut each tracked garment from the best still it shows in. */
const cutFromStills = (
  parts: Parts,
  best: ReadonlyArray<{ readonly sighting: TrackSighting; readonly still: SampledStill & { readonly key: string } }>,
  masks: ReadonlyMap<string, { readonly bounds: TrackSighting['bounds']; readonly raster: Uint8Array }>,
  frameSize: { readonly width: number; readonly height: number },
) =>
  Effect.forEach(best, ({ sighting, still }) =>
    Effect.gen(function* () {
      const bytes = yield* readObject(parts, still.key)
      const mask = masks.get(`${sighting.track}@${sighting.frame}`)
      if (Option.isNone(bytes) || mask === undefined) return []
      const copies = yield* (yield* PictureWork).workingCopies(bytes.value)
      const picture = decodePng(copies.png)
      const fitted = fitMask(mask, frameSize, picture)
      return segmentedPieces(picture, [{ ...fitted, track: sighting.track, confidence: sighting.confidence }]).map(
        (piece): CutPiece & { readonly key: string } => ({ ...piece, key: still.key }),
      )
    }),
  ).pipe(Effect.map((pieces) => pieces.flat()))

/** Track every garment through the video and cut each from the sharpest, fullest still it shows in. */
export const processVideo = (parts: Parts, capture: CaptureRow, frames: ReadonlyArray<FrameRow>) =>
  Effect.gen(function* () {
    const policy = yield* CaptureConfig
    const sharpest = frames.toSorted((a, b) => sum(b.sharpness) - sum(a.sharpness))[0]
    if (sharpest === undefined) return yield* unavailable()
    if (policy.providers === 'off')
      return { found: [yield* originalOnly(parts, capture, sharpest.objectKey)], route: null, provider: 'off' }
    const frameCount =
      capture.frameCount ?? (yield* countFrames(parts, capture)) ?? Math.round(((capture.durationMs ?? 0) / 1000) * 30)
    const durationMs = capture.durationMs ?? 1
    const stills = new Map(
      frames.map((frame) => [
        frameAt(frame.atMs, frameCount, durationMs),
        { index: frame.idx, atMs: frame.atMs, width: 0, height: 0, sharpness: frame.sharpness, key: frame.objectKey },
      ]),
    )
    const segmenter = yield* GarmentSegmenter
    const fileId =
      capture.providerFileId ??
      (yield* segmenter.upload({
        key: capture.originalKey,
        bytes: capture.bytes,
        contentType: capture.contentType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4',
      }))
    yield* storedAs(parts.store.updateCapture(capture.id, { providerFileId: fileId, frameCount }))
    const tracked = yield* segmenter.track(fileId, 'clothing', new Set(stills.keys()))
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
    const pieces = yield* cutFromStills(parts, best, masks, frameSize)
    const found = yield* Effect.forEach(pieces, (piece) => detectionsOf(parts, capture, piece.key, [piece], () => true))
    return { found: found.flat(), route: null, provider: 'sam' }
  })

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)
