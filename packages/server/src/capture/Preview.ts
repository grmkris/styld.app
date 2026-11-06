import { DetectionId, type Keep, PieceType } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { enqueuePicture } from './Shared.ts'
import type { DetectionRow } from './Store.ts'
import { nowDate, stored } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { firstPicture } from './PictureLifecycle.ts'
import { CaptureStore } from './Store.ts'

/** The piece a kept detection becomes: the cut-out unless the person chose the original photo. Its back is the
 * camera's back shot, or else the garment's sighting in another photo picked with it (the pieces laid out again,
 * turned over). */
export const pieceOf = (
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
    seasons: keep.seasons ?? detection.suggestedSeasons,
    rainproof: keep.rainproof ?? detection.suggestedRainproof,
    category: keep.category ?? detection.suggestedCategory,
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
export const picturesFor = (pieces: ReadonlyArray<ReturnType<typeof pieceOf>>, at: Date) =>
  pieces
    .filter(({ imageKey, originalKey }) => imageKey !== originalKey)
    .map(({ id, accountId }) => firstPicture({ pieceId: id, accountId }, at))

/** Hand pictures to the queue: after the batch that stored them, and again for those still waiting when the same
 * review is replayed, so a send lost between the two is made up. The job draws a picture once however often it is
 * sent. */
export const sendPictures = (pieceIds: ReadonlyArray<string>) =>
  Effect.forEach(pieceIds, (pieceId) => enqueuePicture(pieceId), { discard: true })

/** Where each detection came from: its source photo's content type (the upload of a photo capture or of a video's
 * still, as it was received; a garment offered from an outfit photo is its capture's own copy) and how its capture was
 * routed and cut, for keep rates. */
export const sourcesOf = (accountId: string, found: ReadonlyArray<DetectionRow>) =>
  Effect.gen(function* () {
    const rows = yield* stored(
      (yield* CaptureStore).capturesOf(accountId, [...new Set(found.map(({ captureId }) => captureId))]),
    )
    const received = yield* stored(
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

const isPieceType = Schema.is(PieceType)

/** The tray would offer it ticked, with a cut-out to draw, and it is not another sighting or a wardrobe match. */
const previewEligible = (
  row: DetectionRow,
): row is DetectionRow & { suggestedType: typeof PieceType.Type; cutoutKey: string } =>
  row.preselected &&
  row.cutoutKey !== null &&
  row.duplicateOf === null &&
  row.groupOf === null &&
  row.suggestedType !== null &&
  isPieceType(row.suggestedType)

const draftKeep = (detection: DetectionRow & { suggestedType: typeof PieceType.Type }): Keep => ({
  detectionId: DetectionId.make(detection.id),
  type: detection.suggestedType,
})

/** Start a shop-style picture for each detection the tray would offer ticked, and drop a draft the match later hid
 * (another sighting, or already in the wardrobe). Hidden from the wardrobe until the person keeps or discards it. */
export const syncPreviews = (accountId: string, found: ReadonlyArray<DetectionRow>) =>
  Effect.gen(function* () {
    if (found.length === 0) return
    const store = yield* CaptureStore
    const at = yield* nowDate
    const { typeOf } = yield* sourcesOf(accountId, found)
    const existing = yield* stored(
      store.piecesByDetections(
        accountId,
        found.map(({ id }) => id),
      ),
    )
    const byDetection = new Map(existing.flatMap((row) => (row.detectionId === null ? [] : [[row.detectionId, row]])))
    const starting = found.filter(previewEligible)
    const dropping = found.filter((row) => !previewEligible(row) && byDetection.has(row.id))
    if (dropping.length > 0)
      yield* stored(
        store.forgetDrafts(
          accountId,
          dropping.map(({ id }) => id),
          at,
        ),
      )
    const created = yield* Effect.forEach(
      starting.filter((row) => !byDetection.has(row.id)),
      (detection) =>
        Effect.map(newId('pc'), (pieceId) =>
          pieceOf(
            accountId,
            pieceId,
            detection,
            { type: typeOf(detection), back: detection.backCutoutKey },
            draftKeep(detection),
            at,
          ),
        ),
    )
    const pictures = picturesFor(created, at)
    if (created.length > 0) yield* stored(store.addPreviews({ pieces: created, pictures }))
    const known = [
      ...created.map(({ id }) => id),
      ...starting.flatMap((row) => {
        const piece = byDetection.get(row.id)
        return piece === undefined ? [] : [piece.id]
      }),
    ]
    yield* sendPictures(yield* stored(store.waitingPictures(known)))
  })
