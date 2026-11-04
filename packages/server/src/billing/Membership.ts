import { memberships } from '@styld/db'
import { memberDailyCredits, type PlanName } from '@styld/protocol'
import { eq } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { type Database, first, query } from '../kernel/Db.ts'

// Whether an account has a plan, and what that makes its daily allowance: the one rule, read by the credit holds
// (`usage/Holds.ts`), the tray's allowance and `GET /api/credits` alike. D1's `memberships` row is the only record of
// it, written by the webhook and the operator's grant (`billing/Store.ts`). Without a plan the day brings nothing; the
// account's 3 free credits are the Wallet's (owner, 4 November 2026).

const dayMillis = 24 * 60 * 60 * 1000

/** How long a week lasts, in milliseconds: the store's SQL extends the end from the later of now and the current end
 * by this much, and takes it back by this much, never before now. */
export const weekMillis = 7 * dayMillis

/** How long past a subscription's next billing date its access lasts, so a renewal charged a little late never leaves
 * the person without credits meanwhile. */
export const graceMillis = dayMillis

/** An account's membership as D1 has it. */
export interface MembershipRecord {
  readonly plan: PlanName
  /** The end; none for lifetime. */
  readonly until: Date | null
  readonly status: 'active' | 'cancelled' | 'ended'
  readonly customerId: string | null
}

/** Whether the membership gives the members' allowance at `now`: lifetime always, any other until its end. */
export const isActiveAt = (membership: Option.Option<MembershipRecord>, now: Date) =>
  Option.exists(
    membership,
    ({ until, status }) => status !== 'ended' && (until === null || until.getTime() > now.getTime()),
  )

/** The daily allowance at `now`: the members' while a plan is active, else none. */
export const allowanceAt = (membership: Option.Option<MembershipRecord>, now: Date) =>
  isActiveAt(membership, now) ? memberDailyCredits : 0

/** The account's membership, if it ever had one. */
export const membershipOf = (db: Database['Service'], accountId: string) =>
  query(() =>
    db
      .select({
        plan: memberships.plan,
        until: memberships.until,
        status: memberships.status,
        customerId: memberships.customerId,
      })
      .from(memberships)
      .where(eq(memberships.accountId, accountId))
      .limit(1),
  ).pipe(Effect.map((rows): Option.Option<MembershipRecord> => first(rows)))
