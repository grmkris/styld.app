import { once } from '../kernel/Receipts.ts'
import {
  CaptureId,
  NotFound,
  type CreateCapture,
  type CreateVideoCapture,
  type HeldCheckAnswer,
  Tray,
  UploadRefused,
  dailyCredits,
  prices,
  type OperationId,
} from '@styld/protocol'
import { Array, Effect, Option, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { CaptureConfig } from './Policy.ts'
import { type Parts, captureHold, enqueueCapture, storedAs, unavailable } from './Parts.ts'
import { GarmentVision } from './Providers.ts'
import type { CaptureRow, DetectionRow, FrameRow } from './Store.ts'
import { Holds } from '../usage/Holds.ts'
import { findMoov, videoDurationMs, videoFrameCount } from './VideoContainer.ts'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, priorResult, receiptRow, type Identified } from '../kernel/Receipts.ts'

/** A received upload of this account that has not made anything yet. */
const usableUpload = (parts: Parts, accountId: string, uploadId: string) =>
  Effect.gen(function* () {
    const row = yield* storedAs(parts.wardrobeStore.findUpload(uploadId))
    if (Option.isNone(row) || row.value.accountId !== accountId)
      return yield* UploadRefused.make({ reason: 'notFound' })
    if (row.value.status === 'used') return yield* UploadRefused.make({ reason: 'alreadyUsed' })
    if (row.value.status !== 'received') return yield* UploadRefused.make({ reason: 'notReceived' })
    return row.value
  })

/** The receipt of an operation already run: the same capture for the same meaning, a conflict otherwise.
 * A capture still processing is handed to the queue again, in case the first message never left. */
const replayed = (parts: Parts, operation: Identified) =>
  Effect.gen(function* () {
    const { accountId, operationId } = operation
    const prior = yield* priorResult(
      operation,
      yield* storedAs(parts.wardrobeStore.findReceipt(accountId, operationId)),
    )
    if (Option.isNone(prior)) return Option.none<{ readonly captureId: CaptureId }>()
    const capture = yield* storedAs(parts.store.findCapture(accountId, prior.value))
    if (Option.isSome(capture) && capture.value.status === 'processing') yield* enqueueCapture(parts, capture.value.id)
    return Option.some({ captureId: CaptureId.make(prior.value) })
  })

/** A video Styld tracks: a minute at most, at up to 60 frames a second. Meta bills every frame. */
const longestVideoMs = 61_000
const mostVideoFrames = 61 * 60

/** The video's real length and frame count, read from its container in the bucket; the browser's word
 * for them is not what is billed. */
const measureVideo = (parts: Parts, video: { readonly objectKey: string; readonly bytes: number }) =>
  Effect.gen(function* () {
    const moov = yield* Effect.tryPromise({
      try: () =>
        findMoov(async (offset, length) => {
          const object = await parts.bindings.bucket.get(video.objectKey, { range: { offset, length } })
          return object === null ? new Uint8Array() : new Uint8Array(await object.arrayBuffer())
        }, video.bytes),
      catch: unavailable,
    })
    const durationMs = moov === undefined ? undefined : videoDurationMs(moov.bytes)
    const frameCount = moov === undefined ? undefined : videoFrameCount(moov.bytes)
    if (durationMs === undefined || frameCount === undefined) return yield* UploadRefused.make({ reason: 'wrongType' })
    if (durationMs > longestVideoMs || frameCount > mostVideoFrames)
      return yield* UploadRefused.make({ reason: 'tooLong' })
    return { durationMs, frameCount }
  })

/** Hold the credits, then write the capture; give them back if the write fails. */
const admit = (parts: Parts, capture: CaptureRow, frames: ReadonlyArray<FrameRow>, operation: Identified) =>
  Effect.gen(function* () {
    const holds = yield* Holds
    const hold = captureHold(capture)
    yield* holds.reserve({ accountId: capture.accountId, hold, credits: capture.credits })
    yield* parts.store.createCapture(capture, frames, yield* receiptRow(operation, capture.id)).pipe(
      Effect.tapError(() =>
        holds
          .settle(capture.accountId, hold, 'failed')
          .pipe(Effect.ignore({ log: true, message: 'Styld.Capture.admit could not refund a failed capture' })),
      ),
      Effect.mapError(unavailable),
    )
    yield* enqueueCapture(parts, capture.id)
    return { captureId: CaptureId.make(capture.id) }
  })

const baseCapture = (
  accountId: string,
  id: string,
  upload: { readonly id: string; readonly objectKey: string; readonly contentType: string; readonly bytes: number },
  at: Date,
): Omit<CaptureRow, 'kind' | 'source' | 'credits'> => ({
  // The hold and settlement columns go in the baseline (C5); the Wallet is the only record of a hold.
  hold: null,
  attempt: 0,
  trackingStartedAt: null,
  id,
  accountId,
  status: 'processing',
  uploadId: upload.id,
  originalKey: upload.objectKey,
  contentType: upload.contentType,
  bytes: upload.bytes,
  side: null,
  pairsWith: null,
  route: null,
  routeConfidence: null,
  provider: null,
  providerFileId: null,
  frameCount: null,
  durationMs: null,
  width: null,
  height: null,
  settlement: 'held',
  errorCode: null,
  importId: null,
  createdAt: at,
  updatedAt: at,
})

/** The import a capture joins: that of the account's capture it names, which starts one when it has none. A capture
 * that is gone or another account's names none. */
const importOf = (parts: Parts, accountId: string, first: string | undefined) =>
  Effect.gen(function* () {
    if (first === undefined) return null
    const found = yield* storedAs(parts.store.findCapture(accountId, first))
    if (Option.isNone(found)) return null
    if (found.value.importId !== null) return found.value.importId
    yield* storedAs(parts.store.updateCapture(found.value.id, { importId: found.value.id }))
    return found.value.id
  })

/** Creating captures: photos from the picker or the camera, and videos with their stills. */
export const creating = (parts: Parts) => ({
  createCapture: Effect.fn('Styld.Capture.create')(function* (input: CreateCapture) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'createCapture',
      input: [input.uploadId, input.source, input.side ?? null, input.pairsWith ?? null, input.importOf ?? null],
    })
    const earlier = yield* replayed(parts, operation)
    if (Option.isSome(earlier)) return earlier.value
    const upload = yield* usableUpload(parts, accountId, input.uploadId)
    if (!upload.contentType.startsWith('image/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const capture: CaptureRow = {
      ...baseCapture(accountId, yield* newId('cp'), upload, yield* nowDate),
      kind: 'photo',
      source: input.source,
      side: input.side ?? null,
      pairsWith: input.pairsWith ?? null,
      importId: yield* importOf(parts, accountId, input.importOf),
      credits: prices.photo,
    }
    return yield* admit(parts, capture, [], operation)
  }),
  createVideoCapture: Effect.fn('Styld.Capture.createVideo')(function* (input: CreateVideoCapture) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'createVideoCapture',
      input: [input.videoUploadId, input.stills.map(({ uploadId }) => uploadId), input.importOf ?? null],
    })
    const earlier = yield* replayed(parts, operation)
    if (Option.isSome(earlier)) return earlier.value
    const video = yield* usableUpload(parts, accountId, input.videoUploadId)
    if (!video.contentType.startsWith('video/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const uploads = yield* Effect.forEach(input.stills, (still) => usableUpload(parts, accountId, still.uploadId))
    if (uploads.some(({ contentType }) => !contentType.startsWith('image/')))
      return yield* UploadRefused.make({ reason: 'wrongType' })
    const measured = yield* measureVideo(parts, video)
    const id = yield* newId('cp')
    const capture: CaptureRow = {
      ...baseCapture(accountId, id, video, yield* nowDate),
      kind: 'video',
      source: 'video',
      durationMs: measured.durationMs,
      frameCount: measured.frameCount,
      width: input.width,
      height: input.height,
      importId: yield* importOf(parts, accountId, input.importOf),
      // Priced by its measured length: a 30-second part of a long video is 5 credits.
      credits: Math.max(1, Math.ceil(measured.durationMs / 30_000)) * prices.videoHalfMinute,
    }
    const frames = Array.zipWith(input.stills, uploads, (still, upload): FrameRow => ({
      captureId: id,
      idx: 0,
      uploadId: still.uploadId,
      objectKey: upload.objectKey,
      atMs: still.atMs,
      sharpness: still.sharpness,
    })).map((frame, idx) => ({ ...frame, idx }))
    return yield* admit(parts, capture, frames, operation)
  }),
})

const detectionView = (row: DetectionRow, sightings: number) => ({
  id: row.id,
  // A garment the wardrobe already has is offered unticked: skipping it is the likelier choice.
  preselected: row.preselected && row.duplicateOf === null,
  hasCutout: row.cutoutKey !== null,
  hasBack: row.backCutoutKey !== null,
  sightings,
  ...(row.duplicateOf === null ? {} : { alreadyHave: row.duplicateOf }),
  // Under even odds of one whole garment (PhotoPipeline's `verdictOf`), it was offered unticked as part of one.
  partial: row.whole !== null && row.whole < 0.5,
  suggestion: {
    type: row.suggestedType,
    colours: row.suggestedColours,
    season: row.suggestedSeason,
    occasions: row.suggestedOccasions,
    pattern: row.suggestedPattern,
  },
})

/** The tray's cards: one for each garment, shown by the sighting that shows it best, with how often the import saw
 * it. A sighting whose garment's card is gone (decided, or retried away) shows on its own. A capture whose every
 * sighting shows on another capture's card leaves the tray's list, unless it is still being processed. */
const trayCards = (open: {
  readonly captures: ReadonlyArray<CaptureRow>
  readonly detections: ReadonlyArray<DetectionRow>
}) => {
  const shown = new Set(open.detections.filter(({ groupOf }) => groupOf === null).map(({ id }) => id))
  const hidden = (row: DetectionRow) => row.groupOf !== null && shown.has(row.groupOf)
  const sightings = (row: DetectionRow) => 1 + open.detections.filter(({ groupOf }) => groupOf === row.id).length
  return open.captures.flatMap((capture) => {
    const own = open.detections.filter(({ captureId }) => captureId === capture.id)
    const cards = own.filter((row) => !hidden(row))
    return own.length > 0 && cards.length === 0 && capture.status !== 'processing'
      ? []
      : [{ capture, detections: cards.map((row) => detectionView(row, sightings(row))) }]
  })
}

/** The tray: what waits for the person, and today's allowance. */
export const reading = (parts: Parts) => ({
  tray: Effect.fn('Styld.Capture.tray')(function* () {
    const { accountId } = yield* CurrentAccount
    const open = yield* storedAs(parts.store.tray(accountId))
    const remaining = yield* (yield* Holds).remaining(accountId)
    // Only the service writes these rows, through the same schemas; a row that does not decode is a bug.
    return yield* Schema.decodeUnknownEffect(Tray)({
      captures: trayCards(open).map(({ capture, detections }) => ({
        id: capture.id,
        // The tray tells only how a person added something: an assistant's photo and a garment offered from an outfit
        // photo show as picked.
        source: capture.source === 'assistant' || capture.source === 'photos' ? 'picker' : capture.source,
        status: capture.status,
        createdAt: capture.createdAt.toISOString(),
        detections,
      })),
      allowance: { remaining, daily: dailyCredits },
    }).pipe(Effect.orDie)
  }),
  /** Show each other sighting of a garment on its own card again: the import took different garments for one. */
  split: Effect.fn('Styld.Capture.split')(function* (detectionId: string, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    const split = Effect.gen(function* () {
      if (!(yield* storedAs(parts.store.split(accountId, detectionId)))) return yield* NotFound.make({})
    })
    yield* once(
      parts.wardrobeStore,
      { accountId, operationId, command: 'splitDetection', input: detectionId },
      { replay: () => Effect.void, run: Effect.as(split, [undefined, detectionId] as const) },
    )
  }),
  check: Effect.fn('Styld.Capture.check')(function* (
    frame: Uint8Array,
    previous: Option.Option<Uint8Array>,
    layout: 'held' | 'flat',
  ) {
    const vision = yield* GarmentVision
    const policy = yield* CaptureConfig
    const answer = yield* vision
      .checkHeld(
        { bytes: frame, contentType: 'image/jpeg' },
        Option.map(previous, (bytes) => ({ bytes, contentType: 'image/jpeg' as const })),
        layout,
      )
      .pipe(Effect.mapError(unavailable))
    return {
      held: answer.held >= policy.heldConfidence,
      side: answer.side,
      samePrevious: answer.samePrevious >= policy.samePieceConfidence,
      holding: answer.holding >= policy.heldConfidence,
    } satisfies HeldCheckAnswer
  }),
})
