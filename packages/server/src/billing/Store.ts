import { accounts, premium, purchases } from '@styld/db'
import { eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { type Database, query } from '../kernel/Db.ts'
import { premiumWeekMillis } from './Premium.ts'

// The webhook's writes, each one D1 batch (one transaction) whose statements check the purchase row themselves, so a
// payment delivered twice, or two deliveries at once, counts once: the premium end moves only in the batch that writes
// or moves the purchase. The end is computed in SQL from the stored one, never from a read before the batch, so two
// payments of one account landing together both count.

/** A payment Dodo confirmed for one of Styld's premium weeks. */
export interface Payment {
  readonly paymentId: string
  readonly accountId: string
  readonly productId: string
  readonly amount: number
  readonly currency: string
}

/** How a counted payment was taken back. */
export type TakenBack = 'refunded' | 'disputed'

export const billingStore = (db: Database['Service']) => ({
  /** Whether the account still exists (one deleted since its checkout has nothing to credit). */
  accountExists: (accountId: string) =>
    query(() => db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).limit(1)).pipe(
      Effect.map((rows) => rows.length > 0),
    ),
  /** Count a payment: a week more premium (from the later of now and the current end) and its purchase row, both only
   * if the payment is not already recorded. */
  credit: (payment: Payment, now: Date) =>
    query(() =>
      db.batch([
        db.run(
          sql`insert into ${premium} (account_id, until) select ${payment.accountId}, ${now.getTime() + premiumWeekMillis} where not exists (select 1 from ${purchases} where payment_id = ${payment.paymentId}) on conflict (account_id) do update set until = max(${premium.until} + ${premiumWeekMillis}, excluded.until)`,
        ),
        db.run(
          sql`insert into ${purchases} (payment_id, account_id, product_id, amount, currency, status, premium_until_after, created_at, updated_at) select ${payment.paymentId}, ${payment.accountId}, ${payment.productId}, ${payment.amount}, ${payment.currency}, 'succeeded', (select until from ${premium} where account_id = ${payment.accountId}), ${now.getTime()}, ${now.getTime()} where true on conflict (payment_id) do nothing`,
        ),
      ]),
    ),
  /** Take a counted payment back: its week comes off the premium end (never before now) and the purchase is marked,
   * both only while it still stands as succeeded. A payment Styld never counted (another product's) changes nothing. */
  takeBack: (paymentId: string, status: TakenBack, now: Date) =>
    query(() =>
      db.batch([
        db.run(
          sql`update ${premium} set until = max(${now.getTime()}, ${premium.until} - ${premiumWeekMillis}) where account_id = (select account_id from ${purchases} where payment_id = ${paymentId} and status = 'succeeded')`,
        ),
        db.run(
          sql`update ${purchases} set status = ${status}, updated_at = ${now.getTime()} where payment_id = ${paymentId} and status = 'succeeded'`,
        ),
      ]),
    ),
})
