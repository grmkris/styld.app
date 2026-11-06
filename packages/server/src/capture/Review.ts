import { CurrentAccount, NotFound, PieceId, type Review, Reviewed } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { type ReviewDecision } from '../kernel/Metrics.ts'
import { enqueueBackPicture, forgetCaptureObjects } from './Shared.ts'
import { picturesFor, pieceOf, sendPictures, sourcesOf } from './Preview.ts'

import type { DetectionRow } from './Store.ts'
import { nowDate, stored } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, priorResult, receiptRow } from '../kernel/Receipts.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { CaptureMetrics } from '../kernel/Metrics.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import type { CaptureServices } from './Shared.ts'

const decodeReviewed = Schema.decodeUnknownEffect(Schema.fromJsonString(Reviewed))

/** The captures a review leaves with nothing waiting, which the tray stops showing. */
const finishedCaptures = (found: ReadonlyArray<DetectionRow>, decided: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const touched = [...new Set(found.map(({ captureId }) => captureId))]
    const stillOpen = yield* stored((yield* CaptureStore).openDetections(touched))
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
    const done = yield* stored((yield* CaptureStore).capturesOf(accountId, finished))
    yield* Effect.forEach(
      done,
      (capture) =>
        Effect.flatMap(stored(Effect.flatMap(CaptureStore, (store) => store.frames(capture.id))), (frames) =>
          forgetCaptureObjects(capture, frames),
        ),
      { discard: true },
    )
  })

/** Hand each kept piece with a back to the back picture job (owner, 4 November): it draws the back, once. A replayed
 * review sends them all again; a piece without a back is left as it is. */
const sendBacks = (accountId: string, pieceIds: ReadonlyArray<string>) =>
  Effect.forEach(pieceIds, (pieceId) => enqueueBackPicture(accountId, pieceId), { discard: true })

const pairedBack = (
  others: ReadonlyArray<DetectionRow>,
  isPhoto: (detection: DetectionRow) => boolean,
  detection: DetectionRow,
) =>
  others.find(
    (other) =>
      other.groupOf === detection.id && other.captureId !== detection.captureId && isPhoto(other) && isPhoto(detection),
  )?.cutoutKey ?? null

const plannedPieces = (
  accountId: string,
  input: Review,
  open: ReadonlyMap<string, DetectionRow>,
  others: ReadonlyArray<DetectionRow>,
  source: {
    readonly typeOf: (detection: DetectionRow) => string
    readonly isPhoto: (detection: DetectionRow) => boolean
    readonly fromPhotos: (detection: DetectionRow) => boolean
  },
  at: Date,
) =>
  Effect.gen(function* () {
    const existing = yield* stored(
      (yield* CaptureStore).piecesByDetections(accountId, [
        ...input.keep.map(({ detectionId }) => detectionId),
        ...input.discard,
        ...others.map(({ id }) => id),
      ]),
    )
    const existingByDetection = new Map(
      existing.flatMap((row) => (row.detectionId === null ? [] : [[row.detectionId, row] as const])),
    )
    const kept = yield* Effect.forEach(input.keep, (keep) =>
      Effect.gen(function* () {
        const already = existingByDetection.get(keep.detectionId)
        const pieceId = already?.id ?? (yield* newId('pc'))
        return { keep, pieceId, detection: open.get(keep.detectionId) }
      }),
    )
    const pieces = kept.flatMap(({ keep, pieceId, detection }) =>
      detection === undefined
        ? []
        : [
            pieceOf(
              accountId,
              pieceId,
              detection,
              { type: source.typeOf(detection), back: pairedBack(others, source.isPhoto, detection) },
              keep,
              at,
            ),
          ],
    )
    const keptSightings = kept.flatMap(({ keep }) =>
      others.filter(({ groupOf }) => groupOf === keep.detectionId).map(({ id }) => id),
    )
    const discarding = new Set<string>(input.discard)
    const discardedSightings = others.filter(({ groupOf }) => groupOf !== null && discarding.has(groupOf))
    const primary = new Set<string>(kept.map(({ keep }) => keep.detectionId))
    const forgotten = [...input.discard, ...discardedSightings.map(({ id }) => id), ...keptSightings].flatMap((id) => {
      const row = existingByDetection.get(id)
      return row === undefined || primary.has(id) ? [] : [row]
    })
    const pieceIds = pieces.map(({ id }) => id)
    const alreadyDrawn = new Set(
      (yield* stored((yield* CaptureStore).picturesAmong(pieceIds))).map(({ pieceId }) => pieceId),
    )
    return {
      pieces,
      created: pieces.filter((piece) => piece.detectionId === null || !existingByDetection.has(piece.detectionId)),
      revised: pieces.filter((piece) => piece.detectionId !== null && existingByDetection.has(piece.detectionId)),
      forgotten,
      keptIds: [...kept.map(({ keep }) => keep.detectionId), ...keptSightings],
      discardedIds: [...input.discard, ...discardedSightings.map(({ id }) => id)],
      linked: kept.flatMap(({ pieceId, detection }) =>
        detection !== undefined && source.fromPhotos(detection) ? [{ captureId: detection.captureId, pieceId }] : [],
      ),
      pieceIds,
      pictures: picturesFor(
        pieces.filter(({ id, imageKey, originalKey }) => imageKey !== originalKey && !alreadyDrawn.has(id)),
        at,
      ),
    }
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
      yield* stored((yield* WardrobeStore).findReceipt(accountId, input.operationId)),
    )
    if (Option.isSome(prior)) {
      const reviewed = yield* decodeReviewed(prior.value).pipe(Effect.orDie)
      yield* sendPictures(yield* stored((yield* CaptureStore).waitingPictures(reviewed.pieceIds)))
      yield* sendBacks(accountId, reviewed.pieceIds)
      return reviewed
    }
    const ids: ReadonlyArray<string> = [...input.keep.map(({ detectionId }) => detectionId), ...input.discard]
    const found = yield* stored((yield* CaptureStore).detections(accountId, ids))
    const open = new Map(found.filter(({ status }) => status === 'review').map((row) => [row.id, row]))
    if (ids.some((id) => !open.has(id))) return yield* NotFound.make({})
    // A garment's other sightings in its import are kept or discarded with it.
    const others = yield* stored((yield* CaptureStore).sightingsOf(accountId, ids))
    const at = yield* nowDate
    const { typeOf, isPhoto, originOf, fromPhotos } = yield* sourcesOf(accountId, [...found, ...others])
    const planned = yield* plannedPieces(accountId, input, open, others, { typeOf, isPhoto, fromPhotos }, at)
    const finished = yield* finishedCaptures([...found, ...others], [...ids, ...others.map(({ id }) => id)])
    yield* stored(
      (yield* CaptureStore).review({
        pieces: planned.created,
        revised: planned.revised,
        forgotten: planned.forgotten,
        kept: planned.keptIds,
        discarded: planned.discardedIds,
        // A garment offered from an outfit photo is that photo's garment: the new piece is confirmed in it.
        linked: planned.linked,
        finished,
        pictures: planned.pictures,
        receipt: yield* receiptRow(operation, JSON.stringify({ pieceIds: planned.pieceIds })),
        now: at,
      }),
    )
    yield* forgetFinished(accountId, finished)
    yield* countDecisions(input, open, originOf)
    yield* sendPictures(yield* stored((yield* CaptureStore).waitingPictures(planned.pieceIds)))
    yield* sendBacks(
      accountId,
      planned.pieces.filter(({ backImageKey }) => backImageKey !== null).map(({ id }) => id),
    )
    const pieceChanged = yield* PieceChanged
    yield* Effect.forEach(planned.pieceIds, (pieceId) => pieceChanged.changed(pieceId), { discard: true })
    return { pieceIds: planned.pieceIds.map((id) => PieceId.make(id)) }
  }, Effect.provide(context)),
}))
