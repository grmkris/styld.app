import { Context, DateTime, Duration, Effect, Layer } from 'effect'
import { type GenerationServices, send, settleJob, stored } from './Shared.ts'
import { generations } from './Generation.ts'
import { GenerationStore } from './Store.ts'
import { giveUp, work } from './Work.ts'

/** A job untouched this long lost its delivery: a drawing takes 90 s at most. */
const sweepPatience = Duration.minutes(5)
const sweepBatch = 50
/** A job that ended is settled again by every sweep for this long: six sweeps, ten minutes apart. */
const settledAgainFor = Duration.hours(1)

/** Every generation operation over the services it yields (`Shared.ts` `GenerationServices`): the store, the queue,
 * boards, the wardrobe, credits, pacing, the content judge, the planner and the painter. */
const make = Effect.gen(function* () {
  const context = yield* Effect.context<GenerationServices>()
  return {
    ...(yield* generations),
    /** Take a job further; the queue calls it for each delivery. */
    work: (jobId: string) => work(jobId).pipe(Effect.provide(context)),
    /** The queue's last try failed: the job fails and its unspent credits go back. */
    giveUp: (jobId: string) => giveUp(jobId).pipe(Effect.provide(context)),
    /** The schedule's sweep: jobs stalled past a drawing's patience go to the queue again, which settles them; jobs
     * that ended within the last hour have their credit settled again from their status (the first settlement stands),
     * so a failed job whose refund was lost still gives its credit back. */
    sweep: Effect.fn('Styld.Generation.sweep')(function* () {
      const store = yield* GenerationStore
      const now = yield* DateTime.now
      const before = DateTime.toDateUtc(DateTime.subtractDuration(now, sweepPatience))
      const stalled = yield* stored(store.stalledJobs(before, sweepBatch))
      yield* Effect.forEach(stalled, send, { discard: true })
      const after = DateTime.toDateUtc(DateTime.subtractDuration(now, settledAgainFor))
      const ended = yield* stored(store.endedJobs(after, before, sweepBatch))
      yield* Effect.forEach(ended, settleJob, { discard: true })
      return stalled.length + ended.length
    }, Effect.provide(context)),
  }
})

/** Stickers and mood boards Styld makes for boards (M7), over the application's database, its queue, and the board
 * and wardrobe services it acts through. */
export class Generations extends Context.Service<Generations, Effect.Success<typeof make>>()(
  '@styld/server/generation/Generations',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Generations.of(service)),
  ).pipe(Layer.provide(GenerationStore.layer))
}
