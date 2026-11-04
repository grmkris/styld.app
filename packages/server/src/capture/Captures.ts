import { SignedMedia } from '../kernel/SignedMedia.ts'
import { once } from '../kernel/Receipts.ts'
import {
  CaptureId,
  type CreateCapture,
  type CreateVideoCapture,
  CurrentAccount,
  type HeldCheckAnswer,
  NotFound,
  type OperationId,
  prices,
  Tray,
  UploadRefused,
} from '@styld/protocol'
import { Array, Effect, Option, Schema } from 'effect'
import { usableUpload } from '../wardrobe/Shared.ts'
import { verdictOf } from './GarmentRules.ts'
import { capturePolicy } from './Policy.ts'
import { captureHold, enqueueCapture, storedAs, unavailable } from './Shared.ts'
import type { CaptureRow, DetectionRow, FrameRow, UploadedCapture } from './Store.ts'
import { findMoov, videoDurationMs, videoFrameCount } from './VideoContainer.ts'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { identify, madeBefore, receiptRow, type Identified } from '../kernel/Receipts.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { Media } from '../kernel/Media.ts'
import { GarmentVision } from './Providers.ts'
import { Holds } from '../usage/Holds.ts'
import { Pacing } from '../kernel/Pacing.ts'
import type { CaptureServices } from './Shared.ts'

/** The receipt of an operation already run: the same capture for the same meaning, a conflict otherwise.
 * A capture still processing is handed to the queue again, in case the first message never left. */
const replayed = (operation: Identified) =>
  Effect.gen(function* () {
    const { accountId } = operation
    const prior = yield* madeBefore(yield* WardrobeStore, operation)
    if (Option.isNone(prior)) return Option.none<{ readonly captureId: CaptureId }>()
    const capture = yield* storedAs((yield* CaptureStore).findCapture(accountId, prior.value))
    // Its credits are held again first (the same hold, so holding twice is once): the first request may have stopped
    // between writing the capture and holding them.
    if (Option.isSome(capture) && capture.value.status === 'processing') {
      const { id, credits } = capture.value
      yield* (yield* Holds).reserve({ accountId, hold: captureHold(capture.value), credits })
      yield* enqueueCapture(id)
    }
    return Option.some({ captureId: CaptureId.make(prior.value) })
  })

/** A video Styld tracks: a minute at most, at up to 60 frames a second. Meta bills every frame. */
const longestVideoMs = 61_000
const mostVideoFrames = 61 * 60

/** The video's real length and frame count, read from its container in the bucket; the browser's word
 * for them is not what is billed. */
const measureVideo = (video: { readonly objectKey: string; readonly bytes: number }) =>
  Effect.gen(function* () {
    const { bucket } = yield* Media
    const moov = yield* Effect.tryPromise({
      try: () =>
        findMoov(async (offset, length) => {
          const object = await bucket.get(video.objectKey, { range: { offset, length } })
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

/** A capture whose batch failed: the same operation committed after all (its receipt answers), another used one of
 * its uploads, or D1 failed. */
const createFailure = (operation: Identified, uploadIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const earlier = yield* replayed(operation)
    if (Option.isSome(earlier)) return earlier.value
    const store = yield* WardrobeStore
    const used = yield* Effect.forEach(uploadIds, (uploadId) => storedAs(store.findUpload(uploadId)))
    return yield* used.some(Option.exists(({ status }) => status === 'used'))
      ? UploadRefused.make({ reason: 'alreadyUsed' })
      : unavailable()
  })

/** Write the capture first, its uploads spent, then hold its credits: every hold has a row its sweep can settle. Past
 * the daily limit the capture is undone and its uploads can be used again. */
const admit = (capture: UploadedCapture, frames: ReadonlyArray<FrameRow>, operation: Identified) =>
  Effect.gen(function* () {
    const uploadIds = [capture.uploadId, ...frames.map(({ uploadId }) => uploadId)]
    const written = yield* (yield* CaptureStore)
      .createCapture(capture, frames, yield* receiptRow(operation, capture.id))
      .pipe(
        Effect.as(Option.none<{ readonly captureId: CaptureId }>()),
        Effect.catchTag('StoreUnavailable', () => Effect.map(createFailure(operation, uploadIds), Option.some)),
      )
    if (Option.isSome(written)) return written.value
    yield* (yield* Holds)
      .reserve({ accountId: capture.accountId, hold: captureHold(capture), credits: capture.credits })
      .pipe(
        Effect.tapErrorTag('LimitReached', () =>
          storedAs(
            Effect.flatMap(CaptureStore, (store) => store.undoCapture(capture, frames, operation.operationId)),
          ).pipe(Effect.ignore({ log: true, message: 'Styld.Capture.admit could not undo a capture past the limit' })),
        ),
      )
    yield* enqueueCapture(capture.id)
    return { captureId: CaptureId.make(capture.id) }
  })

const baseCapture = (
  accountId: string,
  id: string,
  upload: { readonly id: string; readonly objectKey: string; readonly contentType: string; readonly bytes: number },
  at: Date,
): Omit<UploadedCapture, 'kind' | 'source' | 'credits'> => ({
  attempt: 0,
  trackingStartedAt: null,
  id,
  accountId,
  status: 'processing',
  uploadId: upload.id,
  garmentId: null,
  originalKey: upload.objectKey,
  contentType: upload.contentType,
  bytes: upload.bytes,
  side: null,
  pairsWith: null,
  route: null,
  provider: null,
  providerFileId: null,
  frameCount: null,
  durationMs: null,
  width: null,
  height: null,
  importId: null,
  createdAt: at,
  updatedAt: at,
})

/** The import a capture joins: that of the account's capture it names, which starts one when it has none. A capture
 * that is gone or another account's names none. */
const importOf = (accountId: string, first: string | undefined) =>
  Effect.gen(function* () {
    if (first === undefined) return null
    const found = yield* storedAs((yield* CaptureStore).findCapture(accountId, first))
    if (Option.isNone(found)) return null
    if (found.value.importId !== null) return found.value.importId
    yield* storedAs((yield* CaptureStore).updateCapture(found.value.id, { importId: found.value.id }))
    return found.value.id
  })

/** Creating captures: photos from the picker or the camera, and videos with their stills. */
export const creating = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  createCapture: Effect.fn('Styld.Capture.create')(function* (input: CreateCapture) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'createCapture',
      input: [input.uploadId, input.source, input.side ?? null, input.pairsWith ?? null, input.importOf ?? null],
    })
    const earlier = yield* replayed(operation)
    if (Option.isSome(earlier)) return earlier.value
    const upload = yield* usableUpload(accountId, input.uploadId)
    if (!upload.contentType.startsWith('image/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const capture: UploadedCapture = {
      ...baseCapture(accountId, yield* newId('cp'), upload, yield* nowDate),
      kind: 'photo',
      source: input.source,
      side: input.side ?? null,
      pairsWith: input.pairsWith ?? null,
      importId: yield* importOf(accountId, input.importOf),
      // A back is free (owner, 4 November): the camera asks for one after every front.
      credits: input.side === 'back' ? 0 : prices.photo,
    }
    return yield* admit(capture, [], operation)
  }, Effect.provide(context)),
  createVideoCapture: Effect.fn('Styld.Capture.createVideo')(function* (input: CreateVideoCapture) {
    const { accountId } = yield* CurrentAccount
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'createVideoCapture',
      input: [input.videoUploadId, input.stills.map(({ uploadId }) => uploadId), input.importOf ?? null],
    })
    const earlier = yield* replayed(operation)
    if (Option.isSome(earlier)) return earlier.value
    const video = yield* usableUpload(accountId, input.videoUploadId)
    if (!video.contentType.startsWith('video/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const uploads = yield* Effect.forEach(input.stills, (still) => usableUpload(accountId, still.uploadId))
    if (uploads.some(({ contentType }) => !contentType.startsWith('image/')))
      return yield* UploadRefused.make({ reason: 'wrongType' })
    const measured = yield* measureVideo(video)
    const id = yield* newId('cp')
    const capture: UploadedCapture = {
      ...baseCapture(accountId, id, video, yield* nowDate),
      kind: 'video',
      source: 'video',
      durationMs: measured.durationMs,
      frameCount: measured.frameCount,
      width: input.width,
      height: input.height,
      importId: yield* importOf(accountId, input.importOf),
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
    return yield* admit(capture, frames, operation)
  }, Effect.provide(context)),
}))

/** What the review offers for a found piece: the decision model's suggestion, with the type it was torn with when
 * that differs from the first. */
export const suggestionOfRow = (row: DetectionRow) => ({
  type: row.suggestedType,
  ...(row.suggestedAlternative === null || row.suggestedAlternative === row.suggestedType
    ? {}
    : { alternative: row.suggestedAlternative }),
  colours: row.suggestedColours,
  seasons: row.suggestedSeasons,
  rainproof: row.suggestedRainproof,
  occasions: row.suggestedOccasions,
  pattern: row.suggestedPattern,
})

const detectionView = Effect.fnUntraced(function* (row: DetectionRow, sightings: number) {
  const signed = yield* SignedMedia
  const images: Record<string, string> = {}
  for (const [which, key] of Object.entries({
    cutout: row.cutoutKey ?? row.sourceKey,
    original: row.sourceKey,
    back: row.backCutoutKey,
  })) {
    if (key === null) continue
    const address = yield* signed.address({
      entityId: row.id,
      key,
      contentType: 'image/png',
      variant: which === 'cutout' ? 'thumb' : 'full',
      version: key,
    })
    if (Option.isSome(address)) images[which] = address.value
  }
  return {
    id: row.id,
    // A garment the wardrobe already has is offered unticked: skipping it is the likelier choice.
    preselected: row.preselected && row.duplicateOf === null,
    hasCutout: row.cutoutKey !== null,
    hasBack: row.backCutoutKey !== null,
    sightings,
    ...(row.duplicateOf === null ? {} : { alreadyHave: row.duplicateOf }),
    // Under the bar for one whole garment (`verdictOf`), it was offered unticked as part of one.
    partial: row.whole !== null && verdictOf(row.whole) !== 'preselect',
    suggestion: suggestionOfRow(row),
    ...(Object.keys(images).length === 0 ? {} : { images }),
  }
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
      : [{ capture, detections: cards.map((row) => ({ row, sightings: sightings(row) })) }]
  })
}

/** The tray: what waits for the person, and today's allowance. */
export const reading = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  tray: Effect.fn('Styld.Capture.tray')(function* () {
    const { accountId } = yield* CurrentAccount
    const open = yield* storedAs((yield* CaptureStore).tray(accountId))
    const { remaining, daily } = yield* (yield* Holds).balance(accountId)
    // Only the service writes these rows, through the same schemas; a row that does not decode is a bug.
    const captures = yield* Effect.forEach(trayCards(open), ({ capture, detections }) =>
      Effect.gen(function* () {
        return {
          id: capture.id,
          // The tray tells only how a person added something: a garment offered from an outfit photo shows as picked.
          source: capture.source === 'photos' ? 'picker' : capture.source,
          status: capture.status,
          createdAt: capture.createdAt.toISOString(),
          detections: yield* Effect.forEach(detections, ({ row, sightings }) => detectionView(row, sightings)),
        }
      }),
    )
    return yield* Schema.decodeUnknownEffect(Tray)({
      captures,
      allowance: { remaining, daily },
    }).pipe(Effect.orDie)
  }, Effect.provide(context)),
  /** Show each other sighting of a garment on its own card again: the import took different garments for one. */
  split: Effect.fn('Styld.Capture.split')(function* (detectionId: string, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    const split = Effect.gen(function* () {
      if (!(yield* storedAs((yield* CaptureStore).split(accountId, detectionId)))) return yield* NotFound.make({})
    })
    yield* once(
      yield* WardrobeStore,
      { accountId, operationId, command: 'splitDetection', input: detectionId },
      { replay: () => Effect.void, run: Effect.as(split, [undefined, detectionId] as const) },
    )
  }, Effect.provide(context)),
  check: Effect.fn('Styld.Capture.check')(function* (
    frame: Uint8Array,
    previous: Option.Option<Uint8Array>,
    layout: 'held' | 'flat',
  ) {
    // Each check calls Clef, at the account's pace.
    yield* (yield* Pacing).account('check')
    const vision = yield* GarmentVision
    const policy = capturePolicy
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
  }, Effect.provide(context)),
}))
