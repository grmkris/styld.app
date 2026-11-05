import { prices, PromptRefused, Unavailable } from '@styld/protocol'
import { Effect, Predicate } from 'effect'
import { nowDate, stored } from '../kernel/Db.ts'
import { ContentJudge } from '../safety/Judge.ts'
import { Holds } from '../usage/Holds.ts'
import { jobHold, settleJob } from './Shared.ts'
import { GenerationStore, type JobRow } from './Store.ts'

/** Admission and provider work must finish before the settlement sweep can refund a lost hold. */
export const generationLifetimeMillis = 30 * 60 * 1000

/** A job stays non-runnable until its idempotent credit reservation and prompt check both pass. A delivery that
 * dies before promotion can resume admission; terminal jobs cannot be promoted again. */
export const admitJob = Effect.fn('Styld.Generation.admission')(function* (job: JobRow, operationId?: string) {
  if (job.status !== 'admitting') return
  const store = yield* GenerationStore
  const at = yield* nowDate
  if (at.getTime() - job.createdAt.getTime() > generationLifetimeMillis) {
    const moved = yield* stored(
      store.advanceJob(job.id, ['admitting'], { status: 'failed', reason: 'unavailable', updatedAt: at }),
    )
    if (moved) yield* settleJob({ ...job, status: 'failed' })
    return
  }
  yield* Effect.gen(function* () {
    yield* (yield* Holds).reserve({ accountId: job.accountId, hold: jobHold(job.id), credits: prices[job.kind] })
    const verdict = yield* (yield* ContentJudge)
      .judge({ texts: [job.prompt], pictures: [] })
      .pipe(Effect.mapError(() => Unavailable.make({})))
    if (verdict.state === 'failed') return yield* PromptRefused.make({ reason: verdict.reason ?? 'other' })
    yield* stored(
      store.advanceJob(job.id, ['admitting'], {
        status: job.kind === 'sticker' ? 'drawing' : 'planning',
        updatedAt: yield* nowDate,
      }),
    )
  }).pipe(
    Effect.tapError((error) =>
      Effect.gen(function* () {
        const status = Predicate.isTagged(error, 'PromptRefused') ? 'refused' : 'failed'
        const moved = yield* stored(
          store.advanceJob(job.id, ['admitting'], {
            status,
            reason: status === 'refused' ? 'refused' : 'unavailable',
            updatedAt: yield* nowDate,
          }),
        )
        if (moved) {
          yield* settleJob({ ...job, status })
          if (operationId !== undefined) yield* stored(store.undoJob(job, operationId)).pipe(Effect.ignore)
        }
      }),
    ),
    Effect.mapError((error) =>
      Predicate.isTagged(error, 'PromptRefused') || Predicate.isTagged(error, 'LimitReached')
        ? error
        : Unavailable.make({}),
    ),
  )
})
