import { premium } from '@styld/db'
import { dailyCredits, premiumWeek } from '@styld/protocol'
import { eq } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { type Database, first, query } from '../kernel/Db.ts'

// Until when an account has premium, and what that makes its daily allowance: the one rule, read by the credit holds
// (`usage/Holds.ts`), the tray's allowance and `GET /api/credits` alike. D1's `premium` row is the only record of the
// end, written by the webhook with its purchase (`billing/Store.ts`).

const dayMillis = 24 * 60 * 60 * 1000
const weekMillis = premiumWeek.days * dayMillis

/** The daily allowance at `now` for an account whose premium lasts until `until`. */
export const allowanceAt = (until: Option.Option<Date>, now: Date) =>
  Option.exists(until, (end) => end.getTime() > now.getTime()) ? premiumWeek.dailyCredits : dailyCredits

/** How long a premium week lasts, in milliseconds: the store's SQL extends the end from the later of now and the
 * current end by this much, and takes it back by this much, never before now. */
export const premiumWeekMillis = weekMillis

/** The account's premium end, if it ever had premium. */
export const premiumUntilOf = (db: Database['Service'], accountId: string) =>
  query(() => db.select({ until: premium.until }).from(premium).where(eq(premium.accountId, accountId)).limit(1)).pipe(
    Effect.map((rows) => Option.map(first(rows), (row) => row.until)),
  )
