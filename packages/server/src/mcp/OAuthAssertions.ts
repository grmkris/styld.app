import { Clock, Effect } from 'effect'
import { query } from '../kernel/Db.ts'
import type { D1 } from './OAuth.ts'

// The OAuth server records each assertion it consumed until it expires (`OAuth.ts` `consumeAssertion`).

/** Forget used assertions past their expiry, a batch at a time: an expired one is refused by its own expiry anyway.
 * How many went. */
export const forgetExpiredAssertions = (db: D1, limit: number) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    query(() =>
      db
        .prepare(
          'DELETE FROM oauth_assertions WHERE rowid IN (SELECT rowid FROM oauth_assertions WHERE expires_at < ? ORDER BY expires_at LIMIT ?)',
        )
        .bind(now, limit)
        .run(),
    ).pipe(Effect.map(({ meta }) => meta.changes)),
  )
