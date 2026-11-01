import { Context, DateTime, Duration, Effect, Layer } from 'effect'
import { Boards } from '../boards/Boards.ts'
import { Database } from '../kernel/Db.ts'
import { ContentJudge } from '../safety/Judge.ts'
import { Holds } from '../usage/Holds.ts'
import { Pacing } from '../kernel/Pacing.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { type Deps, send, settleJob, stored } from './Deps.ts'
import { generations } from './Generation.ts'
import { PicturePainter } from './Painter.ts'
import { MoodPlanner } from './Planner.ts'
import { GenerationQueue } from './Queue.ts'
import { generationStore } from './Store.ts'
import { giveUp, work } from './Work.ts'

/** A job untouched this long lost its delivery: a drawing takes 90 s at most. */
const sweepPatience = Duration.minutes(5)
const sweepBatch = 50
/** A job that ended is settled again by every sweep for this long: six sweeps, ten minutes apart. */
const settledAgainFor = Duration.hours(1)

const make = Effect.gen(function* () {
  const deps: Deps = {
    store: generationStore(yield* Database),
    queue: yield* GenerationQueue,
    boards: yield* Boards,
    wardrobe: yield* Wardrobe,
    holds: yield* Holds,
    pacing: yield* Pacing,
    judge: yield* ContentJudge,
    planner: yield* MoodPlanner,
    painter: yield* PicturePainter,
  }
  return {
    ...generations(deps),
    /** Take a job further; the queue calls it for each delivery. */
    work: (jobId: string) => work(deps, jobId),
    /** The queue's last try failed: the job fails and its unspent credits go back. */
    giveUp: (jobId: string) => giveUp(deps, jobId),
    /** The schedule's sweep: jobs stalled past a drawing's patience go to the queue again, which settles them; jobs
     * that ended within the last hour have their credit settled again from their status (the first settlement stands),
     * so a failed job whose refund was lost still gives its credit back. */
    sweep: Effect.fn('Styld.Generation.sweep')(function* () {
      const now = yield* DateTime.now
      const before = DateTime.toDateUtc(DateTime.subtractDuration(now, sweepPatience))
      const stalled = yield* stored(deps.store.stalledJobs(before, sweepBatch))
      yield* Effect.forEach(stalled, (jobId) => send(deps, jobId), { discard: true })
      const after = DateTime.toDateUtc(DateTime.subtractDuration(now, settledAgainFor))
      const ended = yield* stored(deps.store.endedJobs(after, before, sweepBatch))
      yield* Effect.forEach(ended, (job) => settleJob(deps.holds, job), { discard: true })
      return stalled.length + ended.length
    }),
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
  )
}
