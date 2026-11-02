import { generationJobs, generationPictures, operationReceipts } from '@styld/db'
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { forgetReceipt, receiptRows } from '../kernel/Receipts.ts'
import { Database, first, query } from '../kernel/Db.ts'

export type JobRow = typeof generationJobs.$inferSelect
/** A sticker job's one picture. Its `index` column is always 0 until the baseline drops it. */
export type StickerRow = typeof generationPictures.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferInsert
type Drizzle = Database['Service']

/** The statuses of a job not yet ended. */
const running = ['planning', 'drawing', 'arranging'] as const
/** A job's statuses once it has ended. */
const ended = ['done', 'refused', 'failed'] as const

/** Jobs: written once with their receipt, read for their owner or the queue, and moved on from a step. */
const jobQueries = (db: Drizzle) => ({
  ...receiptRows(db),
  /** The job, a sticker's picture and the operation's receipt, as one batch. */
  insertJob: (job: JobRow, sticker: ReadonlyArray<StickerRow>, receipt: ReceiptRow) =>
    query(() =>
      db.batch([
        db.insert(generationJobs).values(job),
        ...sticker.map((picture) => db.insert(generationPictures).values(picture)),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** Undo a job that was never taken on (past the daily limit, or words that failed the check): the job, its picture
   * and its receipt, so the same operation asks again. */
  undoJob: (job: Pick<JobRow, 'id' | 'accountId'>, operationId: string) =>
    query(() =>
      db.batch([
        db.delete(generationPictures).where(eq(generationPictures.jobId, job.id)),
        db.delete(generationJobs).where(eq(generationJobs.id, job.id)),
        forgetReceipt(db, job.accountId, operationId),
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
            inArray(generationJobs.status, [...running]),
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
        .where(and(inArray(generationJobs.status, [...running]), lt(generationJobs.updatedAt, before)))
        .orderBy(asc(generationJobs.updatedAt))
        .limit(limit),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
  /** Jobs that ended between two moments, oldest first: their credit is settled again, in case that settle was lost. */
  endedJobs: (after: Date, before: Date, limit: number) =>
    query(() =>
      db
        .select({ id: generationJobs.id, accountId: generationJobs.accountId, status: generationJobs.status })
        .from(generationJobs)
        .where(
          and(
            inArray(generationJobs.status, [...ended]),
            gte(generationJobs.updatedAt, after),
            lt(generationJobs.updatedAt, before),
          ),
        )
        .orderBy(asc(generationJobs.updatedAt))
        .limit(limit),
    ),
  /** For the generation queue, which acts for the job's account. */
  jobForWork: (jobId: string) =>
    query(() => db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1)).pipe(Effect.map(first)),
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

/** A sticker job's picture, claimed, finished or given up only from the state it was read in. */
const stickerQueries = (db: Drizzle) => ({
  /** The job's sticker, if it is a sticker job. */
  stickerOf: (jobId: string) =>
    query(() => db.select().from(generationPictures).where(eq(generationPictures.jobId, jobId)).limit(1)).pipe(
      Effect.map(first),
    ),
  /** Claim the waiting sticker of a job still drawing; false when another delivery claimed it first, or the job was
   * given up. The claim marks the job as moving, so reading it does not send it again. */
  claimSticker: (jobId: string, at: Date) =>
    query(() =>
      db.batch([
        db
          .update(generationPictures)
          .set({ status: 'drawing', startedAt: at })
          .where(
            and(
              eq(generationPictures.jobId, jobId),
              eq(generationPictures.status, 'waiting'),
              sql`exists (select 1 from ${generationJobs} where ${generationJobs.id} = ${jobId} and ${generationJobs.status} = 'drawing')`,
            ),
          )
          .returning({ jobId: generationPictures.jobId }),
        db.update(generationJobs).set({ updatedAt: at }).where(eq(generationJobs.id, jobId)),
      ]),
    ).pipe(Effect.map(([claimed]) => claimed.length > 0)),
  /** A drawing's outcome, written only over the claim; the job is marked as moving. */
  finishSticker: (jobId: string, outcome: Pick<StickerRow, 'status' | 'imageId'>, at: Date) =>
    query(() =>
      db.batch([
        db
          .update(generationPictures)
          .set(outcome)
          .where(and(eq(generationPictures.jobId, jobId), eq(generationPictures.status, 'drawing'))),
        db.update(generationJobs).set({ updatedAt: at }).where(eq(generationJobs.id, jobId)),
      ]),
    ).pipe(Effect.asVoid),
  /** Give up a job not yet ended: it fails, and a waiting sticker is refused so no delivery claims it. */
  giveUp: (jobId: string, at: Date) =>
    query(() =>
      db.batch([
        db
          .update(generationJobs)
          .set({ status: 'failed', reason: 'unavailable', updatedAt: at })
          .where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...running]))),
        db
          .update(generationPictures)
          .set({ status: 'refused' })
          .where(and(eq(generationPictures.jobId, jobId), eq(generationPictures.status, 'waiting'))),
      ]),
    ).pipe(Effect.asVoid),
})

/** Generation jobs and their stickers over the application's database. A job is written once with its receipt; its
 * sticker moves only from the state it was read in, so two deliveries never draw it twice.
 * @internal Exported for its tests. */
export const generationStore = (db: Drizzle) => ({ ...jobQueries(db), ...stickerQueries(db) })

/** The generation store over the application's one database. */
export class GenerationStore extends Context.Service<GenerationStore, ReturnType<typeof generationStore>>()(
  '@styld/server/generation/GenerationStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, generationStore))
}
