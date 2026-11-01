import { once } from '../kernel/Receipts.ts'
import { type CaptureId, NotFound, type OperationId } from '@styld/protocol'
import { DateTime, Effect, Option } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { captureHold, endingOf, enqueueCapture, forgetCaptureObjects, type Parts, storedAs } from './Parts.ts'
import type { CaptureRow } from './Store.ts'
import { type Ending, Holds } from '../usage/Holds.ts'

/** A capture processing longer than this has lost its queue message: the person may retry or remove it. */
const staleMillis = 30 * 60 * 1000

/** A capture is tried again at most this many times. */
const maximumRetries = 3

const isStale = (capture: CaptureRow, nowMillis: number) =>
  capture.status === 'processing' && nowMillis - capture.updatedAt.getTime() > staleMillis

/** Whether the person may try this capture again: it failed, its answer was lost, or it is stuck. */
const canRetry = (capture: CaptureRow, nowMillis: number) =>
  capture.attempt < maximumRetries &&
  (capture.status === 'failed' || capture.status === 'unknown' || isStale(capture, nowMillis))

/** How a capture the person retries or removes ended: a stuck one failed. */
const ended = (capture: CaptureRow): Ending => Option.getOrElse(endingOf(capture.status), () => 'failed' as const)

/** Move a failed or stuck capture back to processing as its next attempt, paid like the first: the last attempt's
 * hold is refunded (a stuck one's too), and the next one holds the credits again. */
const retried = (parts: Parts, accountId: string, captureId: CaptureId) =>
  Effect.gen(function* () {
    const found = yield* storedAs(parts.store.findCapture(accountId, captureId))
    const now = yield* DateTime.now
    if (Option.isNone(found) || !canRetry(found.value, DateTime.toEpochMillis(now))) return yield* NotFound.make({})
    const capture = found.value
    const holds = yield* Holds
    yield* holds.settle(accountId, captureHold(capture), ended(capture))
    const next = { ...capture, attempt: capture.attempt + 1 }
    yield* holds.reserve({ accountId, hold: captureHold(next), credits: capture.credits })
    const moved = yield* storedAs(
      parts.store.retryCapture(accountId, capture.id, capture, {
        status: 'processing',
        errorCode: null,
        attempt: next.attempt,
        // The person asked again, so a video may be tracked again.
        trackingStartedAt: null,
        updatedAt: DateTime.toDateUtc(now),
      }),
    ).pipe(Effect.tapError(() => holds.settle(accountId, captureHold(next), 'failed').pipe(Effect.ignore)))
    if (!moved) {
      // Another request moved it first: the new hold goes back.
      yield* holds.settle(accountId, captureHold(next), 'failed')
      return yield* NotFound.make({})
    }
    yield* enqueueCapture(parts, capture.id)
  })

/** Try a capture again, or remove one. Each moves the capture only from the state it was read in. */
export const retrying = (parts: Parts) => ({
  retry: Effect.fn('Styld.Capture.retry')(function* (captureId: CaptureId, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    yield* once(
      parts.wardrobeStore,
      { accountId, operationId, command: 'retryCapture', input: captureId },
      {
        replay: () => Effect.void,
        run: Effect.as(retried(parts, accountId, captureId), [undefined, captureId] as const),
      },
    )
  }),
  remove: Effect.fn('Styld.Capture.remove')(function* (captureId: CaptureId) {
    const { accountId } = yield* CurrentAccount
    const found = yield* storedAs(parts.store.findCapture(accountId, captureId))
    const nowMillis = DateTime.toEpochMillis(yield* DateTime.now)
    if (Option.isNone(found)) return yield* NotFound.make({})
    const capture = found.value
    const removable = capture.status !== 'done' && (capture.status !== 'processing' || isStale(capture, nowMillis))
    // A capture whose pieces were kept stays: those pieces show its pictures.
    if (!removable || (yield* storedAs(parts.store.hasKept(capture.id)))) return yield* NotFound.make({})
    // Whatever did not reach the tray gets its credits back; the first settlement stands for one that did.
    yield* (yield* Holds).settle(accountId, captureHold(capture), ended(capture))
    // A back shot folded into this one goes first, with its photo: nothing else shows it.
    for (const back of yield* storedAs(parts.store.foldedBacks(accountId, capture.id))) {
      yield* storedAs(parts.store.deleteCapture(accountId, back.id))
      yield* forgetCaptureObjects(parts, back, [])
    }
    const frames = yield* storedAs(parts.store.frames(capture.id))
    yield* storedAs(parts.store.deleteCapture(accountId, captureId))
    yield* forgetCaptureObjects(parts, capture, frames)
  }),
})
