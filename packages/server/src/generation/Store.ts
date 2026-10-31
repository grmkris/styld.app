import { generationJobs, generationPictures, operationReceipts } from '@styld/db'
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { receiptQuery } from '../Receipts.ts'
import { StoreUnavailable } from '../wardrobe/Store.ts'

export type JobRow = typeof generationJobs.$inferSelect
export type PictureRow = typeof generationPictures.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferInsert

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })
const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

/** Generation jobs and their pictures. A job is written once with its receipt; each picture moves only from the state
 * it was read in, so two deliveries never draw the same picture. */
export const makeGenerationStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return {
    findReceipt: (accountId: string, operationId: string) =>
      attempt(() => receiptQuery(db, accountId, operationId)).pipe(Effect.map(first)),
    /** The job, its first pictures and the operation's receipt, as one batch. */
    insertJob: (job: JobRow, pictures: ReadonlyArray<PictureRow>, receipt: ReceiptRow) =>
      attempt(() =>
        db.batch([
          db.insert(generationJobs).values(job),
          ...pictures.map((picture) => db.insert(generationPictures).values(picture)),
          db.insert(operationReceipts).values(receipt),
        ]),
      ).pipe(Effect.asVoid),
    findJob: (accountId: string, jobId: string) =>
      attempt(() =>
        db
          .select()
          .from(generationJobs)
          .where(and(eq(generationJobs.id, jobId), eq(generationJobs.accountId, accountId)))
          .limit(1),
      ).pipe(Effect.map(first)),
    /** For the generation queue, which acts for the job's account. */
    jobForWork: (jobId: string) =>
      attempt(() => db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1)).pipe(
        Effect.map(first),
      ),
    picturesOf: (jobId: string) =>
      attempt(() =>
        db
          .select()
          .from(generationPictures)
          .where(eq(generationPictures.jobId, jobId))
          .orderBy(asc(generationPictures.index)),
      ),
    /** The plan's pictures, once: a redelivered plan finds them there. */
    planned: (jobId: string, pictures: ReadonlyArray<PictureRow>, job: Partial<JobRow>) =>
      attempt(() =>
        db.batch([
          db.update(generationJobs).set(job).where(eq(generationJobs.id, jobId)),
          ...pictures.map((picture) => db.insert(generationPictures).values(picture).onConflictDoNothing()),
        ]),
      ).pipe(Effect.asVoid),
    updateJob: (jobId: string, job: Partial<JobRow>) =>
      attempt(() => db.update(generationJobs).set(job).where(eq(generationJobs.id, jobId))).pipe(Effect.asVoid),
    /** Claim a waiting picture for drawing; none when another delivery claimed it first. */
    claimPicture: (jobId: string, index: number, at: Date) =>
      attempt(() =>
        db
          .update(generationPictures)
          .set({ status: 'drawing', startedAt: at })
          .where(
            and(
              eq(generationPictures.jobId, jobId),
              eq(generationPictures.index, index),
              eq(generationPictures.status, 'waiting'),
            ),
          )
          .returning({ index: generationPictures.index }),
      ).pipe(Effect.map((rows) => rows.length > 0)),
    /** A drawing's outcome, written only over the claim. */
    finishPicture: (jobId: string, index: number, outcome: Pick<PictureRow, 'status' | 'imageId'>) =>
      attempt(() =>
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
      ).pipe(Effect.asVoid),
  }
}
