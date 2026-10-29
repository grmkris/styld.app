import {
  CaptureId,
  CaptureNotFound,
  type CreateCapture,
  type CreateVideoCapture,
  type HeldCheckAnswer,
  OperationConflict,
  Tray,
  UploadRefused,
} from '@styld/protocol'
import { DateTime, Effect, Option, Predicate, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { CaptureConfig } from './Policy.ts'
import { type Parts, enqueueCapture, storedAs, unavailable } from './Parts.ts'
import { GarmentVision } from './Providers.ts'
import type { CaptureRow, DetectionRow, FrameRow } from './Store.ts'
import { Usage } from './Usage.ts'

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

/** The receipt of an operation already run: the same capture for the same meaning, a conflict otherwise. */
const replayed = (parts: Parts, accountId: string, operationId: string, inputDigest: string) =>
  Effect.gen(function* () {
    const receipt = yield* storedAs(parts.wardrobeStore.findReceipt(accountId, operationId))
    if (Option.isNone(receipt)) return Option.none<string>()
    if (receipt.value.inputDigest !== inputDigest) return yield* OperationConflict.make({})
    return Option.some(receipt.value.result)
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
    yield* usage.reserve(capture.accountId, `capture/${capture.id}`, capture.credits)
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
        Effect.tapError(() => usage.settle(capture.accountId, `capture/${capture.id}`, 'refunded').pipe(Effect.ignore)),
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
    if (Option.isSome(earlier)) return { captureId: CaptureId.make(earlier.value) }
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
    if (Option.isSome(earlier)) return { captureId: CaptureId.make(earlier.value) }
    const video = yield* usableUpload(parts, accountId, input.videoUploadId)
    if (!video.contentType.startsWith('video/')) return yield* UploadRefused.make({ reason: 'wrongType' })
    const stills = yield* Effect.forEach(input.stills, (still) => usableUpload(parts, accountId, still.uploadId))
    const policy = yield* CaptureConfig
    const id = yield* parts.randomId('cp')
    const capture: CaptureRow = {
      ...baseCapture(accountId, id, video, yield* now),
      kind: 'video',
      source: 'video',
      durationMs: input.durationMs,
      width: input.width,
      height: input.height,
      credits: policy.credits.video,
    }
    const frames: Array<FrameRow> = input.stills.map((still, idx) => ({
      captureId: id,
      idx,
      uploadId: still.uploadId,
      objectKey: stills[idx]?.objectKey ?? '',
      atMs: still.atMs,
      sharpness: still.sharpness,
    }))
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
      samePrevious: answer.samePrevious >= 0.6,
    } satisfies HeldCheckAnswer
  }),
})

/** Try a failed or unknown capture again, or remove one. */
export const retrying = (parts: Parts) => ({
  retry: Effect.fn('Styld.Capture.retry')(function* (captureId: CaptureId) {
    const { accountId } = yield* CurrentAccount
    const found = yield* storedAs(parts.store.findCapture(accountId, captureId))
    if (Option.isNone(found) || (found.value.status !== 'failed' && found.value.status !== 'unknown'))
      return yield* CaptureNotFound.make({})
    // A retry is free: a failed capture was refunded and an unknown one still holds its credits.
    yield* storedAs(
      parts.store.updateCapture(found.value.id, { status: 'processing', errorCode: null, updatedAt: yield* now }),
    )
    yield* enqueueCapture(parts, found.value.id)
  }),
  remove: Effect.fn('Styld.Capture.remove')(function* (captureId: CaptureId) {
    const { accountId } = yield* CurrentAccount
    const found = yield* storedAs(parts.store.findCapture(accountId, captureId))
    if (Option.isNone(found) || found.value.status === 'processing') return yield* CaptureNotFound.make({})
    const capture = found.value
    // An unknown outcome may have been billed by the provider, so it is consumed rather than refunded.
    if (capture.settlement === 'held') yield* (yield* Usage).settle(accountId, `capture/${capture.id}`, 'consumed')
    const frames = yield* storedAs(parts.store.frames(capture.id))
    yield* storedAs(parts.store.deleteCapture(accountId, captureId))
    yield* removeObjects(parts, accountId, capture, frames)
  }),
})

/** The capture's own folder, and its photo or video and stills unless a kept piece still shows them. */
const removeObjects = (parts: Parts, accountId: string, capture: CaptureRow, frames: ReadonlyArray<FrameRow>) =>
  Effect.gen(function* () {
    const prefix = `accounts/${accountId}/captures/${capture.id}/`
    const listed = yield* Effect.tryPromise({ try: () => parts.bindings.bucket.list({ prefix }), catch: unavailable })
    const keys = listed.objects.map(({ key }) => key)
    for (const source of [capture.originalKey, ...frames.map(({ objectKey }) => objectKey)])
      if (!(yield* storedAs(parts.store.sourceInUse(accountId, source)))) keys.push(source)
    if (keys.length > 0) yield* Effect.tryPromise({ try: () => parts.bindings.bucket.delete(keys), catch: unavailable })
  }).pipe(Effect.catchIf(Predicate.isTagged('CaptureUnavailable'), () => Effect.void))
