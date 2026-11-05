import { deleting, once } from '../kernel/Receipts.ts'
import { type CaptureId, CurrentAccount, NotFound, type OperationId } from '@styld/protocol'
import { DateTime, Effect, Option, Predicate } from 'effect'
import { captureHold, endingOf, enqueueCapture, forgetCaptureObjects } from './Shared.ts'
import type { CaptureRow } from './Store.ts'
import { type Ending } from '../usage/Holds.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { Holds } from '../usage/Holds.ts'
import type { CaptureServices } from './Shared.ts'
import { stored } from '../kernel/Db.ts'

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

/** A claimed retry whose credits could not be held: the capture as it was. Refused outright, nothing was held and the
 * attempt is not used up; a Wallet that did not answer may have held it, so that hold is refunded and its attempt's
 * number kept, never named again. */
const unretried = (accountId: string, capture: CaptureRow, claimed: Date, refused: boolean) =>
  Effect.gen(function* () {
    const attempt = capture.attempt + 1
    if (!refused) yield* (yield* Holds).settle(accountId, captureHold({ ...capture, attempt }), 'failed')
    yield* (yield* CaptureStore).retryCapture(
      accountId,
      capture.id,
      { status: 'processing', attempt, updatedAt: claimed },
      {
        status: capture.status,
        attempt: refused ? capture.attempt : attempt,
        trackingStartedAt: capture.trackingStartedAt,
        providerFileId: capture.providerFileId,
        updatedAt: capture.updatedAt,
      },
    )
  }).pipe(Effect.ignore({ log: true, message: 'Styld.Capture.retry could not take back a claim' }))

/** Move a failed or stuck capture back to processing as its next attempt, paid like the first. The move from the
 * state and attempt the person saw claims the attempt, so only one of two requests holds and settles its credits;
 * then the last attempt's hold is refunded (a stuck one's too), and the next one holds the credits again. */
const retried = (accountId: string, captureId: CaptureId) =>
  Effect.gen(function* () {
    const found = yield* stored((yield* CaptureStore).findCapture(accountId, captureId))
    const now = yield* DateTime.now
    if (Option.isNone(found) || !canRetry(found.value, DateTime.toEpochMillis(now))) return yield* NotFound.make({})
    const capture = found.value
    const claimed = DateTime.toDateUtc(now)
    const next = { ...capture, attempt: capture.attempt + 1 }
    const moved = yield* stored(
      (yield* CaptureStore).retryCapture(accountId, capture.id, capture, {
        status: 'processing',
        attempt: next.attempt,
        // The person asked again, so a video may be tracked again.
        trackingStartedAt: null,
        providerFileId: null,
        updatedAt: claimed,
      }),
    )
    // Another request moved it first, and holds the next attempt's credits.
    if (!moved) return yield* NotFound.make({})
    const holds = yield* Holds
    yield* holds.settle(accountId, captureHold(capture), ended(capture))
    yield* holds
      .reserve({ accountId, hold: captureHold(next), credits: capture.credits })
      .pipe(
        Effect.tapError((error) => unretried(accountId, capture, claimed, Predicate.isTagged(error, 'LimitReached'))),
      )
    yield* enqueueCapture(capture.id)
  })

/** Try a capture again, or remove one. Each moves the capture only from the state it was read in. */
export const retrying = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  retry: Effect.fn('Styld.Capture.retry')(function* (captureId: CaptureId, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    yield* once(
      yield* WardrobeStore,
      { accountId, operationId, command: 'retryCapture', input: captureId },
      {
        replay: () => Effect.void,
        run: Effect.as(retried(accountId, captureId), [undefined, captureId] as const),
        // A request that died while it retried is answered as done: the capture shows where it stands.
        resume: Effect.void,
      },
    )
  }, Effect.provide(context)),
  /** Remove a capture. Its work is not one batch, so its receipt is written once it is gone: a repeat of the same
   * remove answers done. */
  remove: Effect.fn('Styld.Capture.remove')(function* (captureId: CaptureId, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    const deletion = { accountId, operationId, command: 'removeCapture', target: captureId }
    yield* deleting(yield* WardrobeStore, deletion, (receipt) =>
      Effect.andThen(
        removed(accountId, captureId),
        Effect.flatMap(WardrobeStore, (store) => store.saveReceipt(receipt)),
      ),
    )
  }, Effect.provide(context)),
}))

/** Remove a capture that has not left the tray, and a back shot folded into it, then their objects. */
const removed = (accountId: string, captureId: CaptureId) =>
  Effect.gen(function* () {
    const found = yield* stored((yield* CaptureStore).findCapture(accountId, captureId))
    const nowMillis = DateTime.toEpochMillis(yield* DateTime.now)
    if (Option.isNone(found)) return yield* NotFound.make({})
    const capture = found.value
    const removable = capture.status !== 'done' && (capture.status !== 'processing' || isStale(capture, nowMillis))
    // A capture whose pieces were kept stays: those pieces show its pictures.
    if (!removable || (yield* stored((yield* CaptureStore).hasKept(capture.id)))) return yield* NotFound.make({})
    // Whatever did not reach the tray gets its credits back; the first settlement stands for one that did.
    yield* (yield* Holds).settle(accountId, captureHold(capture), ended(capture))
    // A back shot folded into this one goes first, with its photo: nothing else shows it.
    for (const back of yield* stored((yield* CaptureStore).foldedBacks(accountId, capture.id))) {
      yield* stored((yield* CaptureStore).deleteCapture(accountId, back.id))
      yield* forgetCaptureObjects(back, [])
    }
    const frames = yield* stored((yield* CaptureStore).frames(capture.id))
    yield* stored((yield* CaptureStore).deleteCapture(accountId, captureId))
    yield* forgetCaptureObjects(capture, frames)
  })
