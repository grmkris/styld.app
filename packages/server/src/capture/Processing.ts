import { Effect, Option } from 'effect'
import { captureHold, endingOf, enqueueMatch, forgetCaptureObjects, storedAs } from './Shared.ts'
import type { CaptureRow, DetectionRow } from './Store.ts'
import { type Found as Result, processPhoto } from './Detections.ts'
import { processVideo } from './VideoPipeline.ts'
import { nowDate } from '../kernel/Db.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { Holds } from '../usage/Holds.ts'
import type { CaptureServices } from './Shared.ts'

/** Settle the hold of a capture that ended, by how it ended: one in the tray or done consumes it, one that failed
 * or whose answer was lost refunds it. The first settlement stands, so settling again on every redelivery is safe. */
const settleEnded = (capture: CaptureRow) =>
  Effect.gen(function* () {
    const ending = endingOf(capture.status)
    // A garment offered from an outfit photo holds nothing: its photo paid.
    if (Option.isSome(ending) && capture.credits > 0)
      yield* (yield* Holds).settle(capture.accountId, captureHold(capture), ending.value)
  })

/** A capture that cannot finish shows as failed, and its held credits come back. The status changes
 * first; if the refund then fails, the next delivery settles it (`settlePending`). */
const fail = (captureId: string, code: string) =>
  Effect.gen(function* () {
    const found = yield* storedAs((yield* CaptureStore).captureForProcessing(captureId))
    if (Option.isNone(found)) return
    if (found.value.status === 'processing')
      yield* storedAs(
        (yield* CaptureStore).updateCapture(captureId, {
          status: 'failed',
          errorCode: code,
          updatedAt: yield* nowDate,
        }),
      )
    const latest = found.value.status === 'processing' ? { ...found.value, status: 'failed' as const } : found.value
    yield* settleEnded(latest)
  })

/** A back shot's cut-out becomes the back of the front shot's piece; whether it did. */
const attachBack = (
  accountId: string,
  frontCaptureId: string,
  detections: ReadonlyArray<Pick<DetectionRow, 'cutoutKey' | 'sourceKey' | 'preselected' | 'confidence'>>,
) =>
  Effect.gen(function* () {
    // The piece the camera saw held up; failing that, the surest.
    const back =
      detections.find(({ preselected }) => preselected) ??
      detections.toSorted((one, other) => (other.confidence ?? 0) - (one.confidence ?? 0))[0]
    if (back === undefined) return false
    // The front may already be decided; then the back waits in the tray on its own.
    return yield* storedAs(
      (yield* CaptureStore).attachBack(accountId, frontCaptureId, back.cutoutKey ?? back.sourceKey),
    )
  })

/** A back shot waiting in the tray becomes its front's back, if the front is in the tray too. Both
 * shots look for the other once stored, so whichever finishes second pairs them; pairing twice is
 * harmless. */
const pairBack = (accountId: string, frontCaptureId: string) =>
  Effect.gen(function* () {
    const waiting = yield* storedAs((yield* CaptureStore).waitingBack(accountId, frontCaptureId))
    if (Option.isNone(waiting)) return
    if (yield* attachBack(accountId, frontCaptureId, waiting.value.detections))
      yield* storedAs((yield* CaptureStore).foldBack(waiting.value.capture.id, yield* nowDate))
  })

const pipeline = (capture: CaptureRow) =>
  Effect.gen(function* () {
    if (capture.kind === 'photo') return yield* processPhoto(capture)
    return yield* processVideo(capture, yield* storedAs((yield* CaptureStore).frames(capture.id)))
  })

/** Run a capture's pipeline. A provider that refused the work ends it as failed, and one whose answer was lost
 * leaves it `unknown` for the person to retry; both have their credits back. Both finish here (none); a failure
 * worth retrying goes back to the queue. */
const run = (capture: CaptureRow) =>
  pipeline(capture).pipe(
    Effect.map((result) => Option.some<Result>(result)),
    // Another delivery is tracking this video; it finishes the capture.
    Effect.catchTag('TrackingClaimed', () => Effect.succeed(Option.none<Result>())),
    Effect.catchReasons('ProviderError', {
      OutcomeUnknown: () =>
        Effect.gen(function* () {
          yield* storedAs(
            (yield* CaptureStore).updateCapture(capture.id, {
              status: 'unknown',
              errorCode: 'unknown',
              updatedAt: yield* nowDate,
            }),
          )
          yield* settleEnded({ ...capture, status: 'unknown' })
          return Option.none<Result>()
        }),
      Refused: () => Effect.as(fail(capture.id, 'refused'), Option.none<Result>()),
      Broken: () => Effect.as(fail(capture.id, 'refused'), Option.none<Result>()),
    }),
  )

/** Store what the pipeline found, consume the held credits, and pair a camera shot with its other side. */
const record = (capture: CaptureRow, result: Result) =>
  Effect.gen(function* () {
    yield* storedAs(
      (yield* CaptureStore).finishCapture(capture.id, result.found, {
        status: 'review',
        route: result.route?.garments ?? null,
        routeConfidence: result.route?.confidence ?? null,
        provider: result.provider,
        updatedAt: yield* nowDate,
      }),
    )
    yield* settleEnded({ ...capture, status: 'review' })
    // What no detection shows goes: an earlier attempt's (or a losing delivery's) cut-outs, a video once its garments
    // are cut from its stills, and the stills none was cut from.
    yield* forgetCaptureObjects(
      capture,
      capture.kind === 'video' ? yield* storedAs((yield* CaptureStore).frames(capture.id)) : [],
    )
    if (result.found.some(({ matching }) => matching === 'waiting')) yield* enqueueMatch(capture.id)
    // A back shot of the garment before it becomes that piece's back and stops waiting on its own.
    if (capture.side === 'back' && capture.pairsWith !== null) yield* pairBack(capture.accountId, capture.pairsWith)
    else if (capture.source === 'camera') yield* pairBack(capture.accountId, capture.id)
  })

/** The queue side of captures: process one, or give up on it after the last attempt. */
export const processing = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Process a capture the queue delivered. A capture already finished only has its credits settled, and
   * one whose account was closed is left for the deletion sweep. */
  processCapture: Effect.fn('Styld.Capture.process')(function* (captureId: string) {
    const found = yield* storedAs((yield* CaptureStore).captureForProcessing(captureId))
    if (Option.isNone(found)) return
    const capture = found.value
    if (capture.status !== 'processing') return yield* settleEnded(capture)
    if (!(yield* storedAs((yield* WardrobeStore).accountEnabled(capture.accountId)))) return
    const result = yield* run(capture)
    if (Option.isSome(result)) yield* record(capture, result.value)
  }, Effect.provide(context)),
  /** The last attempt failed: the capture shows as failed and its credits come back. */
  failCapture: Effect.fn('Styld.Capture.fail')(function* (captureId: string) {
    yield* fail(captureId, 'failed')
  }, Effect.provide(context)),
}))
