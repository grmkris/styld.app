import { CurrentAccount, type Keep, NotFound, PieceId, type Review, Reviewed } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { type ReviewDecision } from '../kernel/Metrics.ts'
import { enqueuePicture, forgetCaptureObjects, storedAs } from './Shared.ts'

import type { DetectionRow } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, priorResult, receiptRow } from '../kernel/Receipts.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { CaptureMetrics } from '../kernel/Metrics.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import type { CaptureServices } from './Shared.ts'

const decodeReviewed = Schema.decodeUnknownEffect(Schema.fromJsonString(Reviewed))

/** The piece a kept detection becomes: the cut-out unless the person chose the original photo. Its back is the
 * camera's back shot, or else the garment's sighting in another photo picked with it (the pieces laid out again,
 * turned over). */
const pieceOf = (
  accountId: string,
  pieceId: string,
  detection: DetectionRow,
  source: { readonly type: string; readonly back: string | null },
  keep: Keep,
  at: Date,
) => {
  const original = keep.useOriginal === true || detection.cutoutKey === null
  return {
    id: pieceId,
    accountId,
    name: keep.name ?? null,
    notes: null,
    type: keep.type,
    colours: keep.colours ?? [],
    // The person confirmed what the decision model suggested, or changed it; an attribute they left out stays as
    // suggested.
    season: keep.season ?? detection.suggestedSeason,
    occasions: keep.occasions ?? detection.suggestedOccasions,
    pattern: keep.pattern ?? detection.suggestedPattern,
    brand: null,
    shopUrl: null,
    status: 'ready' as const,
    source: 'website' as const,
    uploadId: null,
    detectionId: detection.id,
    backImageKey: original ? null : (detection.backCutoutKey ?? source.back),
    rotation: 0 as const,
    originalKey: detection.sourceKey,
    imageKey: original ? detection.sourceKey : detection.cutoutKey,
    contentType: source.type,
    createdAt: at,
    updatedAt: at,
  }
}

/** A clean picture waiting to be drawn for each kept piece shown as its cut-out. A piece kept as its original photo
 * never leaves Styld. */
const picturesFor = (pieces: ReadonlyArray<ReturnType<typeof pieceOf>>, at: Date) =>
  pieces
    .filter(({ imageKey, originalKey }) => imageKey !== originalKey)
    .map(({ id, accountId }) => ({
      pieceId: id,
      accountId,
      state: 'queued' as const,
      version: 0,
      redraws: 0,
      paid: false,
      createdAt: at,
      updatedAt: at,
    }))

/** Hand pictures to the queue: after the batch that stored them, and again for those still waiting when the same
 * review is replayed, so a send lost between the two is made up. The job draws a picture once however often it is
 * sent. */
const sendPictures = (pieceIds: ReadonlyArray<string>) =>
  Effect.forEach(pieceIds, (pieceId) => enqueuePicture(pieceId), { discard: true })

/** Where each detection came from: its source photo's content type (the upload of a photo capture or of a video's
 * still, as it was received; a garment offered from an outfit photo is its capture's own copy) and how its capture was
 * routed and cut, for keep rates. */
const sourcesOf = (accountId: string, found: ReadonlyArray<DetectionRow>) =>
  Effect.gen(function* () {
    const rows = yield* storedAs(
      (yield* CaptureStore).capturesOf(accountId, [...new Set(found.map(({ captureId }) => captureId))]),
    )
    const received = yield* storedAs(
      (yield* CaptureStore).uploadTypes(accountId, [...new Set(found.map(({ sourceKey }) => sourceKey))]),
    )
    const types = new Map([
      ...rows.map((row) => [row.originalKey, row.contentType] as const),
      ...received.map((row) => [row.objectKey, row.contentType] as const),
    ])
    const byId = new Map(rows.map((row) => [row.id, row]))
    return {
      /** Every source is a stored upload or a capture's own copy: one that is neither is a bug. */
      typeOf: (detection: DetectionRow) => Option.getOrThrow(Option.fromNullishOr(types.get(detection.sourceKey))),
      isPhoto: (detection: DetectionRow) => byId.get(detection.captureId)?.kind === 'photo',
      /** Whether the garment was offered from an outfit photo (My Gallery). */
      fromPhotos: (detection: DetectionRow) => byId.get(detection.captureId)?.source === 'photos',
      originOf: (detection: DetectionRow) => {
        const capture = byId.get(detection.captureId)
        return { route: capture?.route ?? capture?.kind ?? 'unknown', provider: capture?.provider ?? 'unknown' }
      },
    }
  })

/** The captures a review leaves with nothing waiting, which the tray stops showing. */
const finishedCaptures = (found: ReadonlyArray<DetectionRow>, decided: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const touched = [...new Set(found.map(({ captureId }) => captureId))]
    const stillOpen = yield* storedAs((yield* CaptureStore).openDetections(touched))
    return touched.filter((captureId) =>
      stillOpen.every((row) => row.captureId !== captureId || decided.includes(row.id)),
    )
  })

/** One review metric per decision, with the route and provider that made the piece, for keep rates. */
const countDecisions = (
  input: Review,
  open: ReadonlyMap<string, DetectionRow>,
  originOf: (detection: DetectionRow) => { readonly route: string; readonly provider: string },
) =>
  Effect.gen(function* () {
    const metrics = yield* CaptureMetrics
    const decisions: ReadonlyArray<{ readonly id: string; readonly decision: ReviewDecision['decision'] }> = [
      ...input.keep.map(
        (keep) => ({ id: keep.detectionId, decision: keep.useOriginal === true ? 'original' : 'kept' }) as const,
      ),
      ...input.discard.map((id) => ({ id, decision: 'discarded' }) as const),
    ]
    yield* Effect.forEach(decisions, ({ id, decision }) => {
      const detection = open.get(id)
      const origin = detection === undefined ? { route: 'unknown', provider: 'unknown' } : originOf(detection)
      return metrics.review({ ...origin, decision })
    })
  })

/** A capture with nothing left waiting keeps only what its pieces show: discarded cut-outs, its unused stills and a
 * video go. */
const forgetFinished = (accountId: string, finished: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const done = yield* storedAs((yield* CaptureStore).capturesOf(accountId, finished))
    yield* Effect.forEach(
      done,
      (capture) =>
        Effect.flatMap(storedAs(Effect.flatMap(CaptureStore, (store) => store.frames(capture.id))), (frames) =>
          forgetCaptureObjects(capture, frames),
        ),
      { discard: true },
    )
  })

/** The person's decisions on waiting pieces: kept ones become pieces, the rest are dropped. Replaying an
 * operation id returns the same pieces; reusing it for other decisions is a conflict. */
export const reviewing = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  review: Effect.fn('Styld.Capture.review')(function* (input: Review) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'review',
      input: [input.keep, input.discard],
    })
    const prior = yield* priorResult(
      operation,
      yield* storedAs((yield* WardrobeStore).findReceipt(accountId, input.operationId)),
    )
    if (Option.isSome(prior)) {
      const reviewed = yield* decodeReviewed(prior.value).pipe(Effect.orDie)
      yield* sendPictures(yield* storedAs((yield* CaptureStore).waitingPictures(reviewed.pieceIds)))
      return reviewed
    }
    const ids: ReadonlyArray<string> = [...input.keep.map(({ detectionId }) => detectionId), ...input.discard]
    const found = yield* storedAs((yield* CaptureStore).detections(accountId, ids))
    const open = new Map(found.filter(({ status }) => status === 'review').map((row) => [row.id, row]))
    if (ids.some((id) => !open.has(id))) return yield* NotFound.make({})
    // A garment's other sightings in its import are kept or discarded with it.
    const others = yield* storedAs((yield* CaptureStore).sightingsOf(accountId, ids))
    const at = yield* nowDate
    const { typeOf, isPhoto, originOf, fromPhotos } = yield* sourcesOf(accountId, [...found, ...others])
    const backOf = (detection: DetectionRow) =>
      others.find(
        (other) =>
          other.groupOf === detection.id &&
          other.captureId !== detection.captureId &&
          isPhoto(other) &&
          isPhoto(detection),
      )?.cutoutKey ?? null
    const kept = yield* Effect.forEach(input.keep, (keep) =>
      Effect.map(newId('pc'), (pieceId) => ({ keep, pieceId, detection: open.get(keep.detectionId) })),
    )
    const pieces = kept.flatMap(({ keep, pieceId, detection }) =>
      detection === undefined
        ? []
        : [pieceOf(accountId, pieceId, detection, { type: typeOf(detection), back: backOf(detection) }, keep, at)],
    )
    const keptSightings = kept.flatMap(({ keep }) =>
      others.filter(({ groupOf }) => groupOf === keep.detectionId).map(({ id }) => id),
    )
    const discarding = new Set<string>(input.discard)
    const discardedSightings = others.filter(({ groupOf }) => groupOf !== null && discarding.has(groupOf))
    const pieceIds = pieces.map(({ id }) => id)
    const pictures = picturesFor(pieces, at)
    const finished = yield* finishedCaptures([...found, ...others], [...ids, ...others.map(({ id }) => id)])
    yield* storedAs(
      (yield* CaptureStore).review({
        pieces,
        kept: [...kept.map(({ keep }) => keep.detectionId), ...keptSightings],
        discarded: [...input.discard, ...discardedSightings.map(({ id }) => id)],
        // A garment offered from an outfit photo is that photo's garment: the new piece is confirmed in it.
        linked: kept.flatMap(({ pieceId, detection }) =>
          detection !== undefined && fromPhotos(detection) ? [{ captureId: detection.captureId, pieceId }] : [],
        ),
        finished,
        pictures,
        receipt: yield* receiptRow(operation, JSON.stringify({ pieceIds })),
        now: at,
      }),
    )
    yield* forgetFinished(accountId, finished)
    yield* countDecisions(input, open, originOf)
    yield* sendPictures(pictures.map(({ pieceId }) => pieceId))
    const pieceChanged = yield* PieceChanged
    yield* Effect.forEach(pieceIds, (pieceId) => pieceChanged.changed(pieceId), { discard: true })
    return { pieceIds: pieceIds.map((id) => PieceId.make(id)) }
  }, Effect.provide(context)),
}))
