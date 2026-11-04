import { accountOfEmail } from '@styld/auth/provisioning'
import { accounts, memberships, purchases } from '@styld/db'
import { eq, sql } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { type Database, first, query } from '../kernel/Db.ts'
import { weekMillis } from './Membership.ts'

// The webhook's and the operator's writes, each one D1 batch (one transaction) whose statements check the purchase row
// themselves, so a payment delivered twice, or two deliveries at once, counts once: the membership moves only in the
// batch that writes or moves the purchase. The end is computed in SQL from the stored one, never from a read before the
// batch, so two payments of one account landing together both count. A lifetime membership (no end) is never moved by
// a week or a subscription; only its own refund ends it.
//
// A subscription's events carry absolute facts (its plan, its next billing date, its status), so the same event twice
// writes the same row; each is applied only when it happened no earlier than the last one applied
// (`subscription_event_at`, Dodo's own time), so a retry delivered late never undoes a newer one.

/** A one-time payment Dodo confirmed for a week or lifetime. */
export interface Payment {
  readonly paymentId: string
  readonly accountId: string
  readonly plan: 'week' | 'lifetime'
  readonly productId: string
  readonly amount: number
  readonly currency: string
  readonly customerId: string | null
}

/** How a counted payment was taken back. */
export type TakenBack = 'refunded' | 'disputed'

/** What a subscription event says: running until `periodEnd` (with the grace), cancelled (it keeps access until the
 * end it has), or ended at once (expired, failed, on hold). */
export interface SubscriptionChange {
  readonly accountId: string
  readonly subscriptionId: string
  readonly customerId: string | null
  readonly plan: 'monthly' | 'yearly'
  readonly kind: 'active' | 'cancelled' | 'ended'
  /** The access's end while it runs: the next billing date plus the grace. */
  readonly until: Date
  /** When the event happened, by Dodo's clock. */
  readonly at: Date
}

/** Who a delivery names: the account in the checkout's metadata, else the subscription Styld already knows, else the
 * customer's email (v1's order, for checkouts made without metadata). */
export interface Payer {
  readonly accountId: string | null
  readonly subscriptionId: string | null
  readonly email: string | null
}

/** A subscription event applies to a row that is not lifetime and has seen no newer event. */
const subscriptionMayChange = (at: Date) =>
  sql`${memberships.until} is not null and coalesce(${memberships.subscriptionEventAt}, 0) <= ${at.getTime()}`

/** The account with this id, if it still exists. */
const accountById = (db: Database['Service'], id: string) =>
  query(() => db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).limit(1)).pipe(
    Effect.map((rows) => Option.map(first(rows), (row) => row.id)),
  )

/** The account whose membership is this Dodo subscription. */
const accountBySubscription = (db: Database['Service'], subscription: string) =>
  query(() =>
    db
      .select({ id: memberships.accountId })
      .from(memberships)
      .where(eq(memberships.subscriptionId, subscription))
      .limit(1),
  ).pipe(Effect.map((rows) => Option.map(first(rows), (row) => row.id)))

/** The account an email signs in to. */
const accountByEmail = (db: Database['Service'], email: string) =>
  query(() => accountOfEmail(db, email)).pipe(Effect.map((rows) => Option.map(first(rows), (row) => row.accountId)))

export const billingStore = (db: Database['Service']) => ({
  /** The account a delivery is for, if it still exists (one deleted since its checkout has nothing to credit). */
  accountOf: (payer: Payer) => {
    const tries = [
      Option.map(Option.fromNullishOr(payer.accountId), (id) => accountById(db, id)),
      Option.map(Option.fromNullishOr(payer.subscriptionId), (subscription) => accountBySubscription(db, subscription)),
      Option.map(Option.fromNullishOr(payer.email), (email) => accountByEmail(db, email)),
    ].flatMap(Option.toArray)
    return Effect.gen(function* () {
      for (const next of tries) {
        const found = yield* next
        if (Option.isSome(found)) return found
      }
      return Option.none<string>()
    })
  },
  /** The account an email signs in to. */
  accountOfEmail: (email: string) => accountByEmail(db, email),
  /** Count a one-time payment, only if it is not already recorded: a week more (from the later of now and the current
   * end; a running subscription keeps its plan and status) or lifetime, and its purchase row. */
  credit: (payment: Payment, now: Date) =>
    query(() =>
      db.batch([
        payment.plan === 'week'
          ? db.run(
              sql`insert into ${memberships} (account_id, plan, until, status, customer_id, updated_at) select ${payment.accountId}, 'week', ${now.getTime() + weekMillis}, 'active', ${payment.customerId}, ${now.getTime()} where not exists (select 1 from ${purchases} where payment_id = ${payment.paymentId}) on conflict (account_id) do update set until = max(max(${memberships.until}, ${now.getTime()}) + ${weekMillis}, excluded.until), plan = case when ${memberships.until} is null then ${memberships.plan} when ${memberships.plan} in ('monthly', 'yearly') and ${memberships.status} != 'ended' and ${memberships.until} > ${now.getTime()} then ${memberships.plan} else 'week' end, status = case when ${memberships.until} is null then ${memberships.status} when ${memberships.plan} in ('monthly', 'yearly') and ${memberships.status} != 'ended' and ${memberships.until} > ${now.getTime()} then ${memberships.status} else 'active' end, customer_id = coalesce(excluded.customer_id, ${memberships.customerId}), updated_at = excluded.updated_at`,
            )
          : db.run(
              sql`insert into ${memberships} (account_id, plan, until, status, customer_id, updated_at) select ${payment.accountId}, 'lifetime', null, 'active', ${payment.customerId}, ${now.getTime()} where not exists (select 1 from ${purchases} where payment_id = ${payment.paymentId}) on conflict (account_id) do update set plan = 'lifetime', until = null, status = 'active', customer_id = coalesce(excluded.customer_id, ${memberships.customerId}), updated_at = excluded.updated_at`,
            ),
        db.run(
          sql`insert into ${purchases} (payment_id, account_id, product_id, amount, currency, status, plan, created_at, updated_at) values (${payment.paymentId}, ${payment.accountId}, ${payment.productId}, ${payment.amount}, ${payment.currency}, 'succeeded', ${payment.plan}, ${now.getTime()}, ${now.getTime()}) on conflict (payment_id) do nothing`,
        ),
      ]),
    ),
  /** Take a counted payment back, only while it still stands as succeeded: a week's comes off the end (never before
   * now; a lifetime membership keeps its none), a lifetime ends now. A payment Styld never counted changes nothing. */
  takeBack: (paymentId: string, status: TakenBack, now: Date) =>
    query(() =>
      db.batch([
        db.run(
          sql`update ${memberships} set until = max(${now.getTime()}, ${memberships.until} - ${weekMillis}), updated_at = ${now.getTime()} where ${memberships.until} is not null and account_id = (select account_id from ${purchases} where payment_id = ${paymentId} and status = 'succeeded' and plan = 'week')`,
        ),
        db.run(
          sql`update ${memberships} set until = ${now.getTime()}, status = 'ended', updated_at = ${now.getTime()} where ${memberships.until} is null and account_id = (select account_id from ${purchases} where payment_id = ${paymentId} and status = 'succeeded' and plan = 'lifetime')`,
        ),
        db.run(
          sql`update ${purchases} set status = ${status}, updated_at = ${now.getTime()} where payment_id = ${paymentId} and status = 'succeeded'`,
        ),
      ]),
    ),
  /** Apply one subscription event. Running, it makes (or moves) the membership that subscription's, until the later of
   * its end and the current one; cancelled, it stops renewing and keeps its end; ended, its access stops now. */
  subscription: (change: SubscriptionChange, now: Date) => {
    const { accountId, subscriptionId, customerId, plan, at } = change
    return query(() => {
      if (change.kind === 'active')
        return db.run(
          sql`insert into ${memberships} (account_id, plan, until, status, subscription_id, customer_id, subscription_event_at, updated_at) values (${accountId}, ${plan}, ${change.until.getTime()}, 'active', ${subscriptionId}, ${customerId}, ${at.getTime()}, ${now.getTime()}) on conflict (account_id) do update set plan = excluded.plan, until = max(case when ${memberships.status} = 'ended' then 0 else ${memberships.until} end, excluded.until), status = 'active', subscription_id = excluded.subscription_id, customer_id = coalesce(excluded.customer_id, ${memberships.customerId}), subscription_event_at = excluded.subscription_event_at, updated_at = excluded.updated_at where ${subscriptionMayChange(at)}`,
        )
      if (change.kind === 'cancelled')
        return db.run(
          sql`update ${memberships} set status = 'cancelled', subscription_event_at = ${at.getTime()}, updated_at = ${now.getTime()} where account_id = ${accountId} and subscription_id = ${subscriptionId} and status = 'active' and ${subscriptionMayChange(at)}`,
        )
      return db.run(
        sql`update ${memberships} set status = 'ended', until = min(${memberships.until}, ${now.getTime()}), subscription_event_at = ${at.getTime()}, updated_at = ${now.getTime()} where account_id = ${accountId} and subscription_id = ${subscriptionId} and ${subscriptionMayChange(at)}`,
      )
    }).pipe(Effect.asVoid)
  },
  /** The operator's grant: lifetime, whatever the account had; granting again changes nothing. */
  grantLifetime: (accountId: string, now: Date) =>
    query(() =>
      db.run(
        sql`insert into ${memberships} (account_id, plan, until, status, updated_at) values (${accountId}, 'lifetime', null, 'active', ${now.getTime()}) on conflict (account_id) do update set plan = 'lifetime', until = null, status = 'active', updated_at = excluded.updated_at`,
      ),
    ).pipe(Effect.asVoid),
})
