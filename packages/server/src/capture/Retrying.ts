import { type CaptureId, CaptureNotFound } from '@styld/protocol'
import { Array, DateTime, Effect, Option } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { captureKey, enqueueCapture, holdOf, type Parts, storedAs, unavailable } from './Parts.ts'
import type { CaptureRow, FrameRow } from './Store.ts'
import { Usage } from './Usage.ts'

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

/** Hold a refunded capture's credits again, under a new operation, so a retry is paid like the first try. */
const holdAgain = (capture: CaptureRow) =>
  Effect.gen(function* () {
    const hold = `capture/${capture.id}/${capture.attempt + 1}`
    yield* (yield* Usage).reserve(capture.accountId, hold, capture.credits)
    return hold
  })

/** The capture's own folder and its sources, except anything a piece still shows. R2 lists a page at a
 * time; deleting is tried once, and a failure is logged rather than failing the removal. */
const removeObjects = (parts: Parts, capture: CaptureRow, frames: ReadonlyArray<FrameRow>) =>
  Effect.gen(function* () {
    const prefix = captureKey(capture.accountId, capture.id, '')
    const listed: Array<string> = []
    let cursor: string | undefined
    do {
      const page = yield* Effect.tryPromise({
        try: () => parts.bindings.bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) }),
        catch: unavailable,
      })
      listed.push(...page.objects.map(({ key }) => key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    const candidates = [...listed, capture.originalKey, ...frames.map(({ objectKey }) => objectKey)]
    const inUse = yield* storedAs(parts.store.keysInUse(capture.accountId, candidates))
    const keys = candidates.filter((key) => !inUse.has(key))
    yield* Effect.forEach(Array.chunksOf(keys, 1000), (chunk) =>
      Effect.tryPromise({ try: () => parts.bindings.bucket.delete([...chunk]), catch: unavailable }),
    )
  }).pipe(Effect.ignore({ log: true, message: 'Styld.Capture.remove could not delete stored objects' }))

/** Try a capture again, or remove one. Each moves the capture only from the state it was read in. */
export const retrying = (parts: Parts) => ({
  retry: Effect.fn('Styld.Capture.retry')(function* (captureId: CaptureId) {
    const { accountId } = yield* CurrentAccount
    const found = yield* storedAs(parts.store.findCapture(accountId, captureId))
    const now = yield* DateTime.now
    if (Option.isNone(found) || !canRetry(found.value, DateTime.toEpochMillis(now)))
      return yield* CaptureNotFound.make({})
    const capture = found.value
    // A refunded capture pays again; an unknown or stuck one still holds its credits.
    const hold = capture.settlement === 'refunded' ? Option.some(yield* holdAgain(capture)) : Option.none<string>()
    const moved = yield* storedAs(
      parts.store.retryCapture(accountId, capture.id, capture, {
        status: 'processing',
        errorCode: null,
        attempt: capture.attempt + 1,
        // The person asked again, so a video may be tracked again.
        trackingStartedAt: null,
        updatedAt: DateTime.toDateUtc(now),
        ...Option.match(hold, { onNone: () => ({}), onSome: (held) => ({ hold: held, settlement: 'held' as const }) }),
      }),
    )
    if (!moved) {
      // Another request moved it first: the new hold goes back.
      if (Option.isSome(hold)) yield* (yield* Usage).settle(accountId, hold.value, 'refunded')
      return yield* CaptureNotFound.make({})
    }
    yield* enqueueCapture(parts, capture.id)
  }),
  remove: Effect.fn('Styld.Capture.remove')(function* (captureId: CaptureId) {
    const { accountId } = yield* CurrentAccount
    const found = yield* storedAs(parts.store.findCapture(accountId, captureId))
    const nowMillis = DateTime.toEpochMillis(yield* DateTime.now)
    if (Option.isNone(found)) return yield* CaptureNotFound.make({})
    const capture = found.value
    const removable = capture.status !== 'done' && (capture.status !== 'processing' || isStale(capture, nowMillis))
    // A capture whose pieces were kept stays: those pieces show its pictures.
    if (!removable || (yield* storedAs(parts.store.hasKept(capture.id)))) return yield* CaptureNotFound.make({})
    // A failed capture gets its credits back; an unknown or stuck one may have been billed, so it is consumed.
    if (capture.settlement === 'held')
      yield* (yield* Usage).settle(accountId, holdOf(capture), capture.status === 'failed' ? 'refunded' : 'consumed')
    const frames = yield* storedAs(parts.store.frames(capture.id))
    yield* storedAs(parts.store.deleteCapture(accountId, captureId))
    yield* removeObjects(parts, capture, frames)
  }),
})
