import { Effect, Option } from 'effect'
import { captureHold, endingOf, enqueueMatch, type Parts, storedAs } from './Parts.ts'
import type { Route } from './Providers.ts'
import type { CaptureRow, DetectionRow } from './Store.ts'
import { processPhoto } from './PhotoPipeline.ts'
import { Holds } from '../usage/Holds.ts'
import { processVideo } from './VideoPipeline.ts'
import { nowDate } from '../kernel/Db.ts'

/** What a pipeline found in a capture, and how it was routed. */
interface Result {
  readonly found: ReadonlyArray<DetectionRow>
  readonly route: Route | null
  readonly provider: string
}

/** Settle the hold of a capture that ended, by how it ended: one in the tray or done consumes it, one that failed
 * or whose answer was lost refunds it. The first settlement stands, so settling again on every redelivery is safe. */
export const settleEnded = (parts: Parts, capture: CaptureRow) =>
  Effect.gen(function* () {
    const ending = endingOf(capture.status)
    // A garment offered from an outfit photo holds nothing: its photo paid.
    if (Option.isSome(ending) && capture.credits > 0)
      yield* (yield* Holds).settle(capture.accountId, captureHold(capture), ending.value)
  })

/** A capture that cannot finish shows as failed, and its held credits come back. The status changes
 * first; if the refund then fails, the next delivery settles it (`settlePending`). */
const fail = (parts: Parts, captureId: string, code: string) =>
  Effect.gen(function* () {
    const found = yield* storedAs(parts.store.captureForProcessing(captureId))
    if (Option.isNone(found)) return
    if (found.value.status === 'processing')
      yield* storedAs(
        parts.store.updateCapture(captureId, { status: 'failed', errorCode: code, updatedAt: yield* nowDate }),
      )
    const latest = found.value.status === 'processing' ? { ...found.value, status: 'failed' as const } : found.value
    yield* settleEnded(parts, latest)
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
      yield* storedAs(parts.store.foldBack(waiting.value.capture.id, yield* nowDate))
  })

const pipeline = (parts: Parts, capture: CaptureRow) =>
  Effect.gen(function* () {
    if (capture.kind === 'photo') return yield* processPhoto(parts, capture)
    return yield* processVideo(parts, capture, yield* storedAs(parts.store.frames(capture.id)))
  })

/** Run a capture's pipeline. A provider that refused the work ends it as failed, and one whose answer was lost
 * leaves it `unknown` for the person to retry; both have their credits back. Both finish here (none); a failure
 * worth retrying goes back to the queue. */
const run = (parts: Parts, capture: CaptureRow) =>
  pipeline(parts, capture).pipe(
    Effect.map((result) => Option.some<Result>(result)),
    // Another delivery is tracking this video; it finishes the capture.
    Effect.catchTag('TrackingClaimed', () => Effect.succeed(Option.none<Result>())),
    Effect.catchTag('ProviderOutcomeUnknown', () =>
      Effect.gen(function* () {
        yield* storedAs(
          parts.store.updateCapture(capture.id, { status: 'unknown', errorCode: 'unknown', updatedAt: yield* nowDate }),
        )
        yield* settleEnded(parts, { ...capture, status: 'unknown' })
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
        updatedAt: yield* nowDate,
      }),
    )
    yield* settleEnded(parts, { ...capture, status: 'review' })
    if (result.found.some(({ matching }) => matching === 'waiting')) yield* enqueueMatch(parts, capture.id)
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
    if (capture.status !== 'processing') return yield* settleEnded(parts, capture)
    if (!(yield* storedAs(parts.wardrobeStore.accountEnabled(capture.accountId)))) return
    const result = yield* run(parts, capture)
    if (Option.isSome(result)) yield* record(parts, capture, result.value)
  }),
  /** The last attempt failed: the capture shows as failed and its credits come back. */
  failCapture: Effect.fn('Styld.Capture.fail')(function* (captureId: string) {
    yield* fail(parts, captureId, 'failed')
  }),
})
