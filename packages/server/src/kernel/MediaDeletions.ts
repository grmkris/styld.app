import { mediaDeletions } from '@styld/db'
import { asc, inArray, lt } from 'drizzle-orm'
import { Array, DateTime, Duration, Effect } from 'effect'
import { chunked, type Database, query } from './Db.ts'
import { deletePrefix, type Listing } from './Media.ts'

// A deleted row's own objects go durably: the batch that deletes the row (a piece, a photo) also records its prefix as
// owed a delete, the request then empties the prefix and forgets the record, and the sweep retries every record R2
// could not list or delete just then. A deleted row is never left with bytes nobody will remove.

/** What is owed: the deleted row's own prefix, its account and what it was. */
export interface OwedPrefix {
  readonly prefix: string
  readonly accountId: string
  readonly owner: (typeof mediaDeletions.$inferInsert)['owner']
}

/** Four parameters a row: twenty rows a statement stay under D1's 100. */
const rowsPerStatement = 20

/** The record of owed prefixes over the application's database, for the stores whose deletes owe them. */
export const owedMedia = (db: Database['Service']) => ({
  /** The statements that record the prefixes as owed, for the batch that deletes their rows. A prefix already owed
   * stays as it was. */
  owe: (owed: ReadonlyArray<OwedPrefix>, at: Date) =>
    Array.chunksOf(owed, rowsPerStatement).map((chunk) =>
      db
        .insert(mediaDeletions)
        .values(chunk.map((row) => ({ ...row, createdAt: at })))
        .onConflictDoNothing(),
    ),
  /** Forget prefixes now empty. */
  forget: (prefixes: ReadonlyArray<string>) =>
    Effect.forEach(
      chunked(prefixes),
      (chunk) => query(() => db.delete(mediaDeletions).where(inArray(mediaDeletions.prefix, chunk))),
      { discard: true },
    ),
  /** The oldest prefixes owed since before `until`, at most `limit`. */
  due: (until: Date, limit: number) =>
    query(() =>
      db
        .select({ prefix: mediaDeletions.prefix, owner: mediaDeletions.owner })
        .from(mediaDeletions)
        .where(lt(mediaDeletions.createdAt, until))
        .orderBy(asc(mediaDeletions.createdAt))
        .limit(limit),
    ),
})
export type OwedMedia = ReturnType<typeof owedMedia>

/** Empty each prefix and forget it once it is empty: how many were emptied. One R2 could not empty now stays owed, for
 * the sweep; its row is already gone, so that never fails the caller. */
export const clearOwed = Effect.fn('Styld.Media.clearOwed')(function* (
  owed: OwedMedia,
  bucket: Listing,
  prefixes: ReadonlyArray<Pick<OwedPrefix, 'prefix' | 'owner'>>,
) {
  const emptied = yield* Effect.forEach(
    prefixes,
    ({ prefix, owner }) =>
      deletePrefix(bucket, prefix).pipe(
        Effect.as([prefix]),
        Effect.catchTag('MediaUnavailable', () =>
          Effect.as(
            Effect.logWarning('Styld.Media.delete owed').pipe(Effect.annotateLogs({ 'styld.media.owner': owner })),
            [],
          ),
        ),
      ),
    { concurrency: 6 },
  )
  const gone = emptied.flat()
  // A record left behind only empties an empty prefix again on a later sweep.
  yield* owed
    .forget(gone)
    .pipe(Effect.catchTag('StoreUnavailable', () => Effect.logWarning('Styld.Media.owed record left')))
  return gone.length
})

/** A record this young is still its request's to clear. */
const owedPatience = Duration.minutes(5)

/** The most records one sweep clears. */
const sweepBatch = 50

/** Empty the prefixes owed longest, past their request's patience: how many it emptied. */
export const sweepOwed = Effect.fn('Styld.Media.sweepOwed')(function* (owed: OwedMedia, bucket: Listing) {
  const until = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, owedPatience))
  return yield* clearOwed(owed, bucket, yield* owed.due(until, sweepBatch))
})
