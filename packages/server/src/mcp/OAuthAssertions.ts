import { oauthAssertions } from '@styld/db'
import { asc, inArray, lt, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { type Database, query } from '../kernel/Db.ts'

// The OAuth server records each assertion it consumed until it expires (`OAuth.ts` `consumeAssertion`).

/** Forget used assertions past their expiry, a batch at a time: an expired one is refused by its own expiry anyway.
 * How many went. */
export const forgetExpiredAssertions = (db: Database['Service'], limit: number) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const expired = db
      .select({ row: sql`rowid` })
      .from(oauthAssertions)
      .where(lt(oauthAssertions.expiresAt, now))
      .orderBy(asc(oauthAssertions.expiresAt))
      .limit(limit)
    return query(() =>
      db
        .delete(oauthAssertions)
        .where(inArray(sql`rowid`, expired))
        .returning({ receipt: oauthAssertions.receipt }),
    ).pipe(Effect.map((gone) => gone.length))
  })
