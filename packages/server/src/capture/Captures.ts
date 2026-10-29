import {
  CaptureId,
  type CreateCapture,
  type CreateVideoCapture,
  type HeldCheckAnswer,
  OperationConflict,
  Tray,
  UploadRefused,
} from '@styld/protocol'
import { Array, DateTime, Effect, Option, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { CaptureConfig } from './Policy.ts'
import { type Parts, enqueueCapture, holdOf, storedAs, unavailable } from './Parts.ts'
import { GarmentVision } from './Providers.ts'
import type { CaptureRow, DetectionRow, FrameRow } from './Store.ts'
import { Usage } from './Usage.ts'
import { findMoov, videoDurationMs, videoFrameCount } from './VideoContainer.ts'

const now = Effect.map(DateTime.now, DateTime.toDateUtc)

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
const replayed = (parts: Parts, accountId: string, operationId: string, inputDigest: string) =>
  Effect.gen(function* () {
    const receipt = yield* storedAs(parts.wardrobeStore.findReceipt(accountId, operationId))
    if (Option.isNone(receipt)) return Option.none<{ readonly captureId: CaptureId }>()
    if (receipt.value.inputDigest !== inputDigest) return yield* OperationConflict.make({})
    const capture = yield* storedAs(parts.store.findCapture(accountId, receipt.value.result))
    if (Option.isSome(capture) && capture.value.status === 'processing') yield* enqueueCapture(parts, capture.value.id)
    return Option.some({ captureId: CaptureId.make(receipt.value.result) })
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
const admit = (
  parts: Parts,
  capture: CaptureRow,
  frames: ReadonlyArray<FrameRow>,
  inputDigest: string,
  operationId: string,
) =>
  Effect.gen(function* () {
    const usage = yield* Usage
    yield* usage.reserve(capture.accountId, holdOf(capture), capture.credits)
    yield* parts.store
      .createCapture(capture, frames, {
        accountId: capture.accountId,
        operationId,
        command: capture.kind === 'video' ? 'createVideoCapture' : 'createCapture',
        inputDigest,
        result: capture.id,
        createdAt: capture.createdAt,
      })
      .pipe(
        Effect.tapError(() =>
          usage
            .settle(capture.accountId, holdOf(capture), 'refunded')
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
  hold: `capture/${id}`,
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
  createdAt: at,
  updatedAt: at,
})

/** Creating captures: photos from the picker or the camera, and videos with their stills. */
export const creating = (parts: Parts) => ({
  createCapture: Effect.fn('Styld.Capture.create')(function* (input: CreateCapture) {
    const { accountId } = yield* CurrentAccount
    const inputDigest = yield* parts.digest(
      JSON.stringify(['photo', input.uploadId, input.source, input.side ?? null, input.pairsWith ?? null]),
    )
    const earlier = yield* replayed(parts, accountId, input.operationId, inputDigest)
    if (Option.isSome(earlier)) return earlier.value
    const upload = yield* usableUpload(parts, accountId, input.uploadId)
    if (!upload.contentType.startsWith('image/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const policy = yield* CaptureConfig
    const capture: CaptureRow = {
      ...baseCapture(accountId, yield* parts.randomId('cp'), upload, yield* now),
      kind: 'photo',
      source: input.source,
      side: input.side ?? null,
      pairsWith: input.pairsWith ?? null,
      credits: policy.credits.photo,
    }
    return yield* admit(parts, capture, [], inputDigest, input.operationId)
  }),
  createVideoCapture: Effect.fn('Styld.Capture.createVideo')(function* (input: CreateVideoCapture) {
    const { accountId } = yield* CurrentAccount
    const inputDigest = yield* parts.digest(
      JSON.stringify(['video', input.videoUploadId, input.stills.map(({ uploadId }) => uploadId)]),
    )
    const earlier = yield* replayed(parts, accountId, input.operationId, inputDigest)
    if (Option.isSome(earlier)) return earlier.value
    const video = yield* usableUpload(parts, accountId, input.videoUploadId)
    if (!video.contentType.startsWith('video/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const uploads = yield* Effect.forEach(input.stills, (still) => usableUpload(parts, accountId, still.uploadId))
    if (uploads.some(({ contentType }) => !contentType.startsWith('image/')))
      return yield* UploadRefused.make({ reason: 'wrongType' })
    const measured = yield* measureVideo(parts, video)
    const policy = yield* CaptureConfig
    const id = yield* parts.randomId('cp')
    const capture: CaptureRow = {
      ...baseCapture(accountId, id, video, yield* now),
      kind: 'video',
      source: 'video',
      durationMs: measured.durationMs,
      frameCount: measured.frameCount,
      width: input.width,
      height: input.height,
      credits: policy.credits.video,
    }
    const frames = Array.zipWith(input.stills, uploads, (still, upload): FrameRow => ({
      captureId: id,
      idx: 0,
      uploadId: still.uploadId,
      objectKey: upload.objectKey,
      atMs: still.atMs,
      sharpness: still.sharpness,
    })).map((frame, idx) => ({ ...frame, idx }))
    return yield* admit(parts, capture, frames, inputDigest, input.operationId)
  }),
})

const detectionView = (row: DetectionRow) => ({
  id: row.id,
  preselected: row.preselected,
  hasCutout: row.cutoutKey !== null,
  hasBack: row.backCutoutKey !== null,
  suggestion: {
    category: row.suggestedCategory,
    subcategory: row.suggestedSubcategory,
    colours: row.suggestedColours,
  },
})

/** The tray: what waits for the person, and today's allowance. */
export const reading = (parts: Parts) => ({
  tray: Effect.fn('Styld.Capture.tray')(function* () {
    const { accountId } = yield* CurrentAccount
    const open = yield* storedAs(parts.store.tray(accountId))
    const policy = yield* CaptureConfig
    const remaining = yield* (yield* Usage).remaining(accountId)
    // Only the service writes these rows, through the same schemas; a row that does not decode is a bug.
    return yield* Schema.decodeUnknownEffect(Tray)({
      captures: open.captures.map((capture) => ({
        id: capture.id,
        source: capture.source === 'assistant' ? 'picker' : capture.source,
        status: capture.status,
        createdAt: capture.createdAt.toISOString(),
        detections: open.detections.filter(({ captureId }) => captureId === capture.id).map(detectionView),
      })),
      allowance: { remaining, daily: policy.dailyAllowance },
    }).pipe(Effect.orDie)
  }),
  check: Effect.fn('Styld.Capture.check')(function* (frame: Uint8Array, previous: Option.Option<Uint8Array>) {
    const vision = yield* GarmentVision
    const policy = yield* CaptureConfig
    const answer = yield* vision
      .checkHeld(
        { bytes: frame, contentType: 'image/jpeg' },
        Option.map(previous, (bytes) => ({ bytes, contentType: 'image/jpeg' as const })),
      )
      .pipe(Effect.mapError(unavailable))
    return {
      held: answer.held >= policy.heldConfidence,
      side: answer.side,
      samePrevious: answer.samePrevious >= policy.samePieceConfidence,
    } satisfies HeldCheckAnswer
  }),
})
