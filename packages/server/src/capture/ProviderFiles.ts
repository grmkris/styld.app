import { providerFiles } from '@styld/db'
import { asc, eq, lt } from 'drizzle-orm'
import { DateTime, Duration, Effect } from 'effect'
import type { Sweep } from '../jobs/Sweeps.ts'
import { Database, query } from '../kernel/Db.ts'
import { GarmentSegmenter } from './Providers.ts'

// Videos handed to Meta's Files API are the person's own footage at a provider: each is recorded (`provider_files`) in
// the batch that gives its capture the file id, and forgotten only once Meta confirms it deleted the file or has none.
// Tracking deletes it at once (`Garments.ts`); the sweep deletes whatever is still recorded after that, a failed delete
// included, and account deletion deletes the account's files straight away.

/** A file still recorded this long after it was handed over was not deleted by its tracking: tracking a video takes
 * minutes, and a delete that failed is tried again by the sweep. */
const forgottenAfter = Duration.minutes(30)

/** The most files one sweep deletes. */
const sweepBatch = 50

/** The statement that records a file handed to Meta, for the batch that gives its capture the file id. */
export const fileRecord = (
  db: Database['Service'],
  file: { readonly fileId: string; readonly accountId: string; readonly createdAt: Date },
) =>
  db
    .insert(providerFiles)
    .values({ ...file, provider: 'meta-sam' })
    .onConflictDoNothing()

/** Delete the file at Meta, then its record. A delete Meta did not confirm fails and keeps the record. */
const forgetFile = Effect.fn('Styld.Capture.forgetFile')(function* (fileId: string) {
  yield* (yield* GarmentSegmenter).forget(fileId)
  const db = yield* Database
  yield* query(() => db.delete(providerFiles).where(eq(providerFiles.fileId, fileId)))
})

/** Forget each file, each on its own: one that fails is logged and stays recorded for the sweep. How many there were. */
const forgetEach = (files: ReadonlyArray<{ readonly fileId: string }>) =>
  Effect.as(
    Effect.forEach(
      files,
      ({ fileId }) =>
        forgetFile(fileId).pipe(Effect.ignore({ log: true, message: 'Styld.Capture.forgetFile left a file at Meta' })),
      { discard: true },
    ),
    files.length,
  )

/** The account's files at Meta, deleted now (account deletion); what cannot be deleted now the sweep deletes later. */
export const forgetFilesOf = Effect.fn('Styld.Capture.forgetFilesOf')(function* (accountId: string) {
  const db = yield* Database
  const files = yield* query(() =>
    db.select({ fileId: providerFiles.fileId }).from(providerFiles).where(eq(providerFiles.accountId, accountId)),
  )
  return yield* forgetEach(files)
})

/** The sweep of files tracking did not delete: the oldest first, a batch at a time. */
export const providerFileSweep: Sweep<Database | GarmentSegmenter> = {
  name: 'providerFiles',
  run: Effect.gen(function* () {
    const db = yield* Database
    const until = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, forgottenAfter))
    const files = yield* query(() =>
      db
        .select({ fileId: providerFiles.fileId })
        .from(providerFiles)
        .where(lt(providerFiles.createdAt, until))
        .orderBy(asc(providerFiles.createdAt))
        .limit(sweepBatch),
    )
    return yield* forgetEach(files)
  }),
}
