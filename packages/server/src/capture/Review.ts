import {
  CaptureNotFound,
  type Keep,
  OperationConflict,
  PieceId,
  type Review,
  Reviewed,
  subcategoryFits,
} from '@styld/protocol'
import { DateTime, Effect, Option, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { CaptureMetrics, type ReviewDecision } from './Metrics.ts'
import { type Parts, storedAs, unavailable } from './Parts.ts'
import type { DetectionRow } from './Store.ts'

const decodeReviewed = Schema.decodeUnknownEffect(Schema.fromJsonString(Reviewed))

/** The piece a kept detection becomes: the cut-out unless the person chose the original photo. */
const pieceOf = (
  accountId: string,
  pieceId: string,
  detection: DetectionRow,
  sourceType: string,
  keep: Keep,
  at: Date,
) => {
  const original = keep.useOriginal === true || detection.cutoutKey === null
  const subcategory =
    keep.subcategory !== undefined && subcategoryFits(keep.category, keep.subcategory) ? keep.subcategory : null
  return {
    id: pieceId,
    accountId,
    name: keep.name ?? null,
    notes: null,
    category: keep.category,
    subcategory,
    colours: keep.colours ?? [],
    status: 'ready' as const,
    source: 'website' as const,
    uploadId: null,
    detectionId: detection.id,
    backImageKey: original ? null : detection.backCutoutKey,
    originalKey: detection.sourceKey,
    imageKey: original ? detection.sourceKey : detection.cutoutKey,
    contentType: sourceType,
    bytes: 0,
    createdAt: at,
    updatedAt: at,
  }
}

/** Where each detection came from: its source photo's content type (the person's own upload for a photo
 * capture, a sampled JPEG still for a video) and how its capture was routed and cut, for keep rates. */
const sourcesOf = (parts: Parts, accountId: string, found: ReadonlyArray<DetectionRow>) =>
  Effect.map(
    storedAs(parts.store.capturesOf(accountId, [...new Set(found.map(({ captureId }) => captureId))])),
    (rows) => {
      const originals = new Map(rows.map((row) => [row.originalKey, row.contentType]))
      const byId = new Map(rows.map((row) => [row.id, row]))
      return {
        typeOf: (detection: DetectionRow) => originals.get(detection.sourceKey) ?? 'image/jpeg',
        originOf: (detection: DetectionRow) => {
          const capture = byId.get(detection.captureId)
          return { route: capture?.route ?? capture?.kind ?? 'unknown', provider: capture?.provider ?? 'unknown' }
        },
      }
    },
  )

/** The captures a review leaves with nothing waiting, which the tray stops showing. */
const finishedCaptures = (parts: Parts, found: ReadonlyArray<DetectionRow>, decided: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const touched = [...new Set(found.map(({ captureId }) => captureId))]
    const stillOpen = yield* storedAs(parts.store.openDetections(touched))
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

/** The person's decisions on waiting pieces: kept ones become pieces, the rest are dropped. Replaying an
 * operation id returns the same pieces; reusing it for other decisions is a conflict. */
export const reviewing = (parts: Parts) => ({
  review: Effect.fn('Styld.Capture.review')(function* (input: Review) {
    const { accountId } = yield* CurrentAccount
    const inputDigest = yield* parts.digest(JSON.stringify([input.keep, input.discard]))
    const receipt = yield* storedAs(parts.wardrobeStore.findReceipt(accountId, input.operationId))
    if (Option.isSome(receipt))
      return receipt.value.inputDigest === inputDigest
        ? yield* decodeReviewed(receipt.value.result).pipe(Effect.orDie)
        : yield* OperationConflict.make({})
    const ids: ReadonlyArray<string> = [...input.keep.map(({ detectionId }) => detectionId), ...input.discard]
    const found = yield* storedAs(parts.store.detections(accountId, ids))
    const open = new Map(found.filter(({ status }) => status === 'review').map((row) => [row.id, row]))
    if (ids.some((id) => !open.has(id))) return yield* CaptureNotFound.make({})
    const at = DateTime.toDateUtc(yield* DateTime.now)
    const { typeOf, originOf } = yield* sourcesOf(parts, accountId, found)
    const kept = yield* Effect.forEach(input.keep, (keep) =>
      Effect.map(parts.randomId('pc'), (pieceId) => ({ keep, pieceId, detection: open.get(keep.detectionId) })),
    )
    const pieces = kept.flatMap(({ keep, pieceId, detection }) =>
      detection === undefined ? [] : [pieceOf(accountId, pieceId, detection, typeOf(detection), keep, at)],
    )
    const pieceIds = pieces.map(({ id }) => id)
    yield* storedAs(
      parts.store.review({
        pieces,
        kept: kept.map(({ keep, pieceId }) => ({ detectionId: keep.detectionId, pieceId })),
        discarded: input.discard,
        finished: yield* finishedCaptures(parts, found, ids),
        receipt: {
          accountId,
          operationId: input.operationId,
          command: 'review',
          inputDigest,
          result: JSON.stringify({ pieceIds }),
          createdAt: at,
        },
        now: at,
      }),
    )
    yield* countDecisions(input, open, originOf)
    return { pieceIds: pieceIds.map((id) => PieceId.make(id)) }
  }),
})

/** The stored key of a detection's picture, if it has one. */
const pictureKey = (row: DetectionRow, which: 'cutout' | 'original' | 'back') =>
  which === 'original' ? row.sourceKey : which === 'back' ? row.backCutoutKey : (row.cutoutKey ?? row.sourceKey)

/** Detections' pictures, for the review tray. */
export const detectionPictures = (parts: Parts) => ({
  /** The picture of a detection for its owner: its cut-out, its back, or the photo it was found in. */
  detectionPicture: Effect.fn('Styld.Capture.detectionPicture')(function* (
    detectionId: string,
    which: 'cutout' | 'original' | 'back',
  ) {
    const { accountId } = yield* CurrentAccount
    const row = yield* storedAs(parts.store.findDetection(accountId, detectionId))
    const key = Option.flatMapNullishOr(row, (detection) => pictureKey(detection, which))
    if (Option.isNone(key)) return Option.none<{ readonly bytes: Uint8Array; readonly contentType: string }>()
    return yield* Effect.tryPromise({
      try: async () => {
        const object = await parts.bindings.bucket.get(key.value)
        return object === null
          ? Option.none()
          : Option.some({
              bytes: new Uint8Array(await object.arrayBuffer()),
              contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
            })
      },
      catch: unavailable,
    })
  }),
})
