import { accounts, importCopies } from '@styld/db'
import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { DateTime, Duration, Effect } from 'effect'
import { Database, fenced, query } from '../kernel/Db.ts'
import { Media, deleteKeys } from '../kernel/Media.ts'
import type { Sweep } from '../jobs/Sweeps.ts'

/** Copy intent precedes R2. A closed account fails the NOT NULL constraint before any bytes leave the bundle. */
export const copyRows = (db: Database['Service']) => ({
  beginCopy: (objectKey: string, accountId: string, createdAt: Date) =>
    fenced(() =>
      db.insert(importCopies).values({
        objectKey,
        createdAt,
        accountId: sql`(${db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.enabled, true)))})`,
      }),
    ),
})

/** Only an unadopted copy goes. A successful piece batch removes the intent atomically, including when its reply
 * was lost. Failed deletion keeps the intent for the sweep. */
export const discardCopy = Effect.fn('Styld.Imports.discardCopy')(function* (objectKey: string) {
  const db = yield* Database
  const rows = yield* query(() =>
    db
      .update(importCopies)
      .set({ state: 'discarding' })
      .where(eq(importCopies.objectKey, objectKey))
      .returning({ objectKey: importCopies.objectKey }),
  )
  if (rows.length === 0) return
  yield* deleteKeys((yield* Media).bucket, [objectKey])
  yield* query(() => db.delete(importCopies).where(eq(importCopies.objectKey, objectKey)))
})

/** Queue deliveries live at most fifteen minutes. A copy still unadopted after an hour has no writer left. */
export const importCopySweep: Sweep<Database | Media> = {
  name: 'importCopies',
  run: Effect.gen(function* () {
    const db = yield* Database
    const before = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, Duration.hours(1)))
    const copies = yield* query(() =>
      db
        .select()
        .from(importCopies)
        .where(lt(importCopies.createdAt, before))
        .orderBy(asc(importCopies.createdAt))
        .limit(100),
    )
    yield* Effect.forEach(copies, ({ objectKey }) => discardCopy(objectKey).pipe(Effect.ignore), { discard: true })
    return copies.length
  }),
}
