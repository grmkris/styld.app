import { generationJobs } from '@styld/db'
import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'
import { type Database as Db, query } from '../kernel/Db.ts'
import { allowed, lifecycle } from '../kernel/Lifecycle.ts'

// A generation job's lifecycle (`generation_jobs.status`), and the one writer of it: every move goes from the status
// the job was read in, along `jobLifecycle`. A job waits for its credit and its prompt's check (`admitting`); a
// sticker is then drawn, a mood board planned and arranged; each ends done, refused, or failed, and never moves again.

type Database = Db['Service']
type JobRow = typeof generationJobs.$inferSelect
export type JobState = JobRow['status']

/** What a move writes besides the status. */
export type JobChanges = Partial<Omit<JobRow, 'id' | 'accountId' | 'status'>>

/** @internal Exported for its tests. */
export const jobLifecycle = lifecycle<JobState>('generation job', {
  admitting: ['planning', 'drawing', 'refused', 'failed'],
  planning: ['arranging', 'refused', 'failed'],
  drawing: ['done', 'refused', 'failed'],
  arranging: ['done', 'failed'],
  done: [],
  refused: [],
  failed: [],
})

/** The status a job is created in. */
export const firstJobState = 'admitting' as const satisfies JobState

/** The statuses of a job not yet ended. */
export const runningJob = ['admitting', 'planning', 'drawing', 'arranging'] as const satisfies ReadonlyArray<JobState>

/** The job moved from one of `from` to `to` within `scope`, as a statement for a batch. */
const jobMove = (db: Database, scope: SQL, from: ReadonlyArray<JobState>, to: JobState, changes: JobChanges) =>
  db
    .update(generationJobs)
    .set({ ...changes, status: to })
    .where(and(scope, inArray(generationJobs.status, [...from])))
    .returning({ id: generationJobs.id })

/** Move the job from one of `from` to `to`, with `changes`; whether it moved. */
export const advanceJob = (
  db: Database,
  jobId: string,
  from: ReadonlyArray<JobState>,
  to: JobState,
  changes: JobChanges,
) =>
  Effect.andThen(
    allowed(jobLifecycle, from, to),
    query(() => jobMove(db, eq(generationJobs.id, jobId), from, to, changes)),
  ).pipe(Effect.map((rows) => rows.length > 0))

/** The moves written inside another statement's batch, each on the table (`WorkLifecycles.test.ts`).
 * @internal Exported for its tests. */
export const batchedJobMoves = {
  /** A mood board planned, with its picks: on to arranging. */
  planned: { from: ['planning'], to: 'arranging' },
  /** A job given up before it ended. */
  givenUp: { from: runningJob, to: 'failed' },
} as const satisfies Record<string, { readonly from: ReadonlyArray<JobState>; readonly to: JobState }>

/** A mood board's plan stored: the job on to arranging, as the last statement of the batch that stores its picks. */
export const arranging = (db: Database, jobId: string, changes: JobChanges) =>
  jobMove(db, eq(generationJobs.id, jobId), batchedJobMoves.planned.from, batchedJobMoves.planned.to, changes)

/** A job given up, as a statement for the batch that refuses its waiting sticker. */
export const givenUp = (db: Database, jobId: string, changes: JobChanges) =>
  jobMove(db, eq(generationJobs.id, jobId), batchedJobMoves.givenUp.from, batchedJobMoves.givenUp.to, changes)
