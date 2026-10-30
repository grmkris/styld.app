import { DateTime, Effect, Option } from 'effect'
import { holdOf, type Parts, storedAs } from './Parts.ts'
import type { Route } from './Providers.ts'
import type { CaptureRow, DetectionRow } from './Store.ts'
import { processPhoto } from './PhotoPipeline.ts'
import { Usage } from './Usage.ts'
import { processVideo } from './VideoPipeline.ts'

const now = Effect.map(DateTime.now, DateTime.toDateUtc)

/** What a pipeline found in a capture, and how it was routed. */
interface Result {
  readonly found: ReadonlyArray<DetectionRow>
  readonly route: Route | null
  readonly provider: string
}

/** Settle a capture's held credits, consumed or refunded, and record which. The Wallet answers a
 * repeated settle as already done, so a retried delivery settles once. */
const settle = (parts: Parts, capture: CaptureRow, outcome: 'consumed' | 'refunded') =>
  Effect.gen(function* () {
    yield* (yield* Usage).settle(capture.accountId, holdOf(capture), outcome)
    yield* storedAs(parts.store.updateCapture(capture.id, { settlement: outcome }))
  })

/** Credits a finished capture still holds: kept results consume them, a failure refunds them. An unknown
 * outcome keeps them until the person tries again or removes it. */
const settlePending = (parts: Parts, capture: CaptureRow) => {
  if (capture.settlement !== 'held') return Effect.void
  if (capture.status === 'review' || capture.status === 'done') return settle(parts, capture, 'consumed')
  return capture.status === 'failed' ? settle(parts, capture, 'refunded') : Effect.void
}

/** A capture that cannot finish shows as failed, and its held credits come back. The status changes
 * first; if the refund then fails, the next delivery settles it (`settlePending`). */
const fail = (parts: Parts, captureId: string, code: string) =>
  Effect.gen(function* () {
    const found = yield* storedAs(parts.store.captureForProcessing(captureId))
    if (Option.isNone(found)) return
    if (found.value.status === 'processing')
      yield* storedAs(
        parts.store.updateCapture(captureId, { status: 'failed', errorCode: code, updatedAt: yield* now }),
      )
    const latest = found.value.status === 'processing' ? { ...found.value, status: 'failed' as const } : found.value
    yield* settlePending(parts, latest)
  })

/** A back shot's cut-out becomes the back of the front shot's piece; whether it did. */
const attachBack = (
  parts: Parts,
  accountId: string,
  frontCaptureId: string,
  detections: ReadonlyArray<Pick<DetectionRow, 'cutoutKey' | 'sourceKey' | 'preselected' | 'confidence'>>,
) =>
  Effect.gen(function* () {
    // The piece the camera saw held up; failing that, the surest. Without a cut-out (providers off) the
    // back is the photo itself, as the front is.
    const back =
      detections.find(({ preselected }) => preselected) ??
      detections.toSorted((one, other) => (other.confidence ?? 0) - (one.confidence ?? 0))[0]
    if (back === undefined) return false
    // The front may already be decided; then the back waits in the tray on its own.
    return yield* storedAs(parts.store.attachBack(accountId, frontCaptureId, back.cutoutKey ?? back.sourceKey))
  })

/** A back shot waiting in the tray becomes its front's back, if the front is in the tray too. Both
 * shots look for the other once stored, so whichever finishes second pairs them; pairing twice is
 * harmless. */
const pairBack = (parts: Parts, accountId: string, frontCaptureId: string) =>
  Effect.gen(function* () {
    const waiting = yield* storedAs(parts.store.waitingBack(accountId, frontCaptureId))
    if (Option.isNone(waiting)) return
    if (yield* attachBack(parts, accountId, frontCaptureId, waiting.value.detections))
      yield* storedAs(parts.store.foldBack(waiting.value.capture.id, yield* now))
  })

const pipeline = (parts: Parts, capture: CaptureRow) =>
  Effect.gen(function* () {
    if (capture.kind === 'photo') return yield* processPhoto(parts, capture)
    return yield* processVideo(parts, capture, yield* storedAs(parts.store.frames(capture.id)))
  })

/** Run a capture's pipeline. A provider that refused the work ends it as failed with its credits back;
 * one whose answer was lost leaves it `unknown` with its credits held, for the person to retry. Both
 * finish here (none); a failure worth retrying goes back to the queue. */
const run = (parts: Parts, capture: CaptureRow) =>
  pipeline(parts, capture).pipe(
    Effect.map((result) => Option.some<Result>(result)),
    // Another delivery is tracking this video; it finishes the capture.
    Effect.catchTag('TrackingClaimed', () => Effect.succeed(Option.none<Result>())),
    Effect.catchTag('ProviderOutcomeUnknown', () =>
      Effect.gen(function* () {
        yield* storedAs(
          parts.store.updateCapture(capture.id, { status: 'unknown', errorCode: 'unknown', updatedAt: yield* now }),
        )
        return Option.none<Result>()
      }),
    ),
    Effect.catchTag('ProviderFailed', (error) =>
      Effect.gen(function* () {
        if (error.retryable) return yield* error
        yield* fail(parts, capture.id, 'refused')
        return Option.none<Result>()
      }),
    ),
  )

/** Store what the pipeline found, consume the held credits, and pair a camera shot with its other side. */
const record = (parts: Parts, capture: CaptureRow, result: Result) =>
  Effect.gen(function* () {
    yield* storedAs(
      parts.store.finishCapture(capture.id, result.found, {
        status: 'review',
        route: result.route?.garments ?? null,
        routeConfidence: result.route?.confidence ?? null,
        provider: result.provider,
        updatedAt: yield* now,
      }),
    )
    yield* settlePending(parts, { ...capture, status: 'review' })
    // A back shot of the garment before it becomes that piece's back and stops waiting on its own.
    if (capture.side === 'back' && capture.pairsWith !== null)
      yield* pairBack(parts, capture.accountId, capture.pairsWith)
    else if (capture.source === 'camera') yield* pairBack(parts, capture.accountId, capture.id)
  })

/** The queue side of captures: process one, or give up on it after the last attempt. */
export const processing = (parts: Parts) => ({
  /** Process a capture the queue delivered. A capture already finished only has its credits settled, and
   * one whose account was closed is left for the deletion sweep. */
  processCapture: Effect.fn('Styld.Capture.process')(function* (captureId: string) {
    const found = yield* storedAs(parts.store.captureForProcessing(captureId))
    if (Option.isNone(found)) return
    const capture = found.value
    if (capture.status !== 'processing') return yield* settlePending(parts, capture)
    if (!(yield* storedAs(parts.wardrobeStore.accountEnabled(capture.accountId)))) return
    const result = yield* run(parts, capture)
    if (Option.isSome(result)) yield* record(parts, capture, result.value)
  }),
  /** The last attempt failed: the capture shows as failed and its credits come back. */
  failCapture: Effect.fn('Styld.Capture.fail')(function* (captureId: string) {
    yield* fail(parts, captureId, 'failed')
  }),
})
