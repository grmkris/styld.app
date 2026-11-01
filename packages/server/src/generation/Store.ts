import { generationJobs, generationPictures, operationReceipts } from '@styld/db'
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { receiptRows } from '../kernel/Receipts.ts'
import { first, query } from '../kernel/Db.ts'

export type JobRow = typeof generationJobs.$inferSelect
export type PictureRow = typeof generationPictures.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferInsert

/** Jobs: written once with their receipt, read for their owner or the queue, and moved on from a step. */
const jobQueries = (db: ReturnType<typeof drizzle>) => ({
  ...receiptRows(db),
  /** The job, its first pictures and the operation's receipt, as one batch. */
  insertJob: (job: JobRow, pictures: ReadonlyArray<PictureRow>, receipt: ReceiptRow) =>
    query(() =>
      db.batch([
        db.insert(generationJobs).values(job),
        ...pictures.map((picture) => db.insert(generationPictures).values(picture)),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  findJob: (accountId: string, jobId: string) =>
    query(() =>
      db
        .select()
        .from(generationJobs)
        .where(and(eq(generationJobs.id, jobId), eq(generationJobs.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The account's newest job for the board that has not ended. */
  runningJob: (accountId: string, boardId: string) =>
    query(() =>
      db
        .select()
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.accountId, accountId),
            eq(generationJobs.boardId, boardId),
            inArray(generationJobs.status, ['planning', 'drawing', 'arranging']),
          ),
        )
        .orderBy(desc(generationJobs.createdAt))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** Jobs not ended and not touched since `before`: their messages were lost or their deliveries died. */
  stalledJobs: (before: Date, limit: number) =>
    query(() =>
      db
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(
          and(
            inArray(generationJobs.status, ['planning', 'drawing', 'arranging']),
            lt(generationJobs.updatedAt, before),
          ),
        )
        .limit(limit),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** For the generation queue, which acts for the job's account. */
  jobForWork: (jobId: string) =>
    query(() => db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1)).pipe(Effect.map(first)),
  picturesOf: (jobId: string) =>
    query(() =>
      db
        .select()
        .from(generationPictures)
        .where(eq(generationPictures.jobId, jobId))
        .orderBy(asc(generationPictures.index)),
    ),
  /** The plan's pictures, once, while the job is still being planned: a redelivered plan finds them there. */
  planned: (jobId: string, pictures: ReadonlyArray<PictureRow>, job: Partial<JobRow>) =>
    query(() =>
      db.batch([
        db
          .update(generationJobs)
          .set(job)
          .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'planning'))),
        ...pictures.map((picture) => db.insert(generationPictures).values(picture).onConflictDoNothing()),
      ]),
    ).pipe(Effect.asVoid),
  /** Move the job on only from a step it is still at, so a job given up stays given up. */
  advanceJob: (jobId: string, from: ReadonlyArray<JobRow['status']>, job: Partial<JobRow>) =>
    query(() =>
      db
        .update(generationJobs)
        .set(job)
        .where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...from])))
        .returning({ id: generationJobs.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
})

/** A job's pictures, each claimed, finished or put back only from the state it was read in. */
const pictureQueries = (db: ReturnType<typeof drizzle>) => ({
  /** Claim a waiting picture of a job still drawing; none when another delivery claimed it first, or the job was
   * given up. The claim marks the job as moving, so reading it does not send it again. */
  claimPicture: (jobId: string, index: number, at: Date) =>
    query(() =>
      db.batch([
        db
          .update(generationPictures)
          .set({ status: 'drawing', startedAt: at })
          .where(
            and(
              eq(generationPictures.jobId, jobId),
              eq(generationPictures.index, index),
              eq(generationPictures.status, 'waiting'),
              sql`exists (select 1 from ${generationJobs} where ${generationJobs.id} = ${jobId} and ${generationJobs.status} = 'drawing')`,
            ),
          )
          .returning({ index: generationPictures.index }),
        db.update(generationJobs).set({ updatedAt: at }).where(eq(generationJobs.id, jobId)),
      ]),
    ).pipe(Effect.map(([claimed]) => claimed.length > 0)),
  /** A drawing's outcome, written only over the claim; the job is marked as moving. */
  finishPicture: (jobId: string, index: number, outcome: Pick<PictureRow, 'status' | 'imageId'>, at: Date) =>
    query(() =>
      db.batch([
        db
          .update(generationPictures)
          .set(outcome)
          .where(
            and(
              eq(generationPictures.jobId, jobId),
              eq(generationPictures.index, index),
              eq(generationPictures.status, 'drawing'),
            ),
          ),
        db.update(generationJobs).set({ updatedAt: at }).where(eq(generationJobs.id, jobId)),
      ]),
    ).pipe(Effect.asVoid),
  /** Put a claim back: the painter was never reached, so the picture waits for the next delivery. */
  releasePicture: (jobId: string, index: number) =>
    query(() =>
      db
        .update(generationPictures)
        .set({ status: 'waiting', startedAt: null })
        .where(
          and(
            eq(generationPictures.jobId, jobId),
            eq(generationPictures.index, index),
            eq(generationPictures.status, 'drawing'),
          ),
        ),
    ).pipe(Effect.asVoid),
  /** Give up a job not yet ended: it fails, and its waiting pictures are refused so no delivery claims them. */
  giveUp: (jobId: string, at: Date) =>
    query(() =>
      db.batch([
        db
          .update(generationJobs)
          .set({ status: 'failed', reason: 'unavailable', updatedAt: at })
          .where(
            and(eq(generationJobs.id, jobId), inArray(generationJobs.status, ['planning', 'drawing', 'arranging'])),
          )
          .returning({ id: generationJobs.id }),
        db
          .update(generationPictures)
          .set({ status: 'refused' })
          .where(and(eq(generationPictures.jobId, jobId), eq(generationPictures.status, 'waiting')))
          .returning({ index: generationPictures.index }),
      ]),
    ),
})

/** Generation jobs and their pictures. A job is written once with its receipt; each picture moves only from the state
 * it was read in, so two deliveries never draw the same picture. */
export const makeGenerationStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return { ...jobQueries(db), ...pictureQueries(db) }
}
