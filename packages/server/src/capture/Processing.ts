import { DateTime, Effect, Option } from 'effect'
import { type Parts, storedAs } from './Parts.ts'
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

/** Settle a capture's held credits, consumed or refunded, and record which. */
const settle = (parts: Parts, captureId: string, accountId: string, outcome: 'consumed' | 'refunded') =>
  Effect.gen(function* () {
    yield* (yield* Usage).settle(accountId, `capture/${captureId}`, outcome)
    yield* storedAs(parts.store.updateCapture(captureId, { settlement: outcome }))
  })

/** A capture that cannot finish shows as failed, and its held credits come back. */
const fail = (parts: Parts, captureId: string, code: string) =>
  Effect.gen(function* () {
    const found = yield* storedAs(parts.store.captureForProcessing(captureId))
    if (Option.isNone(found) || found.value.status !== 'processing') return
    yield* storedAs(parts.store.updateCapture(captureId, { status: 'failed', errorCode: code, updatedAt: yield* now }))
    if (found.value.settlement === 'held') yield* settle(parts, captureId, found.value.accountId, 'refunded')
  })

/** A back shot's cut-out becomes the back of the front shot's piece, and stops waiting on its own. */
const attachBack = (
  parts: Parts,
  accountId: string,
  frontCaptureId: string,
  detections: ReadonlyArray<{ readonly id: string; readonly cutoutKey: string | null; readonly preselected: boolean }>,
) =>
  Effect.gen(function* () {
    const back = detections.find(({ preselected, cutoutKey }) => preselected && cutoutKey !== null)
    if (back?.cutoutKey === undefined || back.cutoutKey === null) return false
    yield* storedAs(parts.store.attachBack(accountId, frontCaptureId, back.cutoutKey))
    return true
  })

/** Run a capture's pipeline. A provider that refused the work ends it as failed with its credits back;
 * one whose answer was lost leaves it `unknown` with its credits held, for the person to retry. Both
 * finish here (none); a failure worth retrying goes back to the queue. */
const run = (parts: Parts, capture: CaptureRow) =>
  (capture.kind === 'video'
    ? Effect.flatMap(storedAs(parts.store.frames(capture.id)), (frames) => processVideo(parts, capture, frames))
    : processPhoto(parts, capture)
  ).pipe(
    Effect.map(Option.some),
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

/** Store what the pipeline found, fold a back shot into its front, and consume the held credits. */
const record = (parts: Parts, capture: CaptureRow, result: Result) =>
  Effect.gen(function* () {
    // A back shot of the garment before it becomes that piece's back; it does not wait on its own.
    const pairsWith = capture.side === 'back' ? capture.pairsWith : null
    const paired = pairsWith === null ? false : yield* attachBack(parts, capture.accountId, pairsWith, result.found)
    const found = paired
      ? result.found.map((detection) => ({ ...detection, status: 'discarded' as const }))
      : result.found
    yield* storedAs(
      parts.store.finishCapture(capture.id, found, {
        status: paired ? 'done' : 'review',
        route: result.route?.garments ?? null,
        routeConfidence: result.route?.confidence ?? null,
        provider: result.provider,
        updatedAt: yield* now,
      }),
    )
    if (capture.settlement === 'held') yield* settle(parts, capture.id, capture.accountId, 'consumed')
  })

/** The queue side of captures: process one, or give up on it after the last attempt. */
export const processing = (parts: Parts) => ({
  /** Process a capture the queue delivered; finished or missing ones are left alone. */
  processCapture: Effect.fn('Styld.Capture.process')(function* (captureId: string) {
    const found = yield* storedAs(parts.store.captureForProcessing(captureId))
    if (Option.isNone(found) || found.value.status !== 'processing') return
    const result = yield* run(parts, found.value)
    if (Option.isSome(result)) yield* record(parts, found.value, result.value)
  }),
  /** The last attempt failed: the capture shows as failed and its credits come back. */
  failCapture: Effect.fn('Styld.Capture.fail')(function* (captureId: string) {
    yield* fail(parts, captureId, 'failed')
  }),
})
