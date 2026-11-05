import { accountOfEmail } from '@styld/auth/provisioning'
import { accounts, memberships, purchases } from '@styld/db'
import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, notExists, sql } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { allOf, anyOf } from '../kernel/Conditional.ts'
import { type Database, fenced, first, query } from '../kernel/Db.ts'
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
  allOf(
    isNotNull(memberships.until),
    anyOf(isNull(memberships.subscriptionEventAt), lte(memberships.subscriptionEventAt, at)),
  )

/** The customer the event names, else the one the membership already has. */
const customerOf = (customerId: string | null) => customerId ?? memberships.customerId

/** A week more on a membership already there: from the later of its end and now (a lifetime's none stays none), and
 * a running subscription keeps its plan and status. */
const weekMore = (now: Date, customerId: string | null) => {
  const running = and(
    inArray(memberships.plan, ['monthly', 'yearly']),
    ne(memberships.status, 'ended'),
    gt(memberships.until, now),
  )
  return {
    until: sql`max(max(${memberships.until}, ${now.getTime()}) + ${weekMillis}, ${now.getTime() + weekMillis})`,
    plan: sql`case when ${isNull(memberships.until)} then ${memberships.plan} when ${running} then ${memberships.plan} else 'week' end`,
    status: sql`case when ${isNull(memberships.until)} then ${memberships.status} when ${running} then ${memberships.status} else 'active' end`,
    customerId: customerOf(customerId),
    updatedAt: now,
  }
}

/** Lifetime over whatever membership is there. */
const lifetime = (now: Date, customerId: string | null) => ({
  plan: 'lifetime' as const,
  until: null,
  status: 'active' as const,
  customerId: customerOf(customerId),
  updatedAt: now,
})

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

/** Count a one-time payment, only if it is not already recorded: a week more (from the later of now and the current
 * end; a running subscription keeps its plan and status) or lifetime, and its purchase row. The membership is
 * selected from the account's row, so an account gone meanwhile writes no membership; the purchase row's foreign key
 * then fails the whole batch, as before, which `fenced` answers as the store being unavailable (Dodo retries). */
const creditBatch = (db: Database['Service'], payment: Payment, now: Date) =>
  db.batch([
    db
      .insert(memberships)
      .select(
        db
          .select({
            accountId: accounts.id,
            plan: sql`${payment.plan}`.as('plan'),
            until: sql`${payment.plan === 'week' ? now.getTime() + weekMillis : null}`.as('until'),
            status: sql`'active'`.as('status'),
            customerId: sql`${payment.customerId}`.as('customer_id'),
            updatedAt: sql`${now.getTime()}`.as('updated_at'),
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.id, payment.accountId),
              notExists(
                db
                  .select({ paymentId: purchases.paymentId })
                  .from(purchases)
                  .where(eq(purchases.paymentId, payment.paymentId)),
              ),
            ),
          ),
      )
      .onConflictDoUpdate({
        target: memberships.accountId,
        set: payment.plan === 'week' ? weekMore(now, payment.customerId) : lifetime(now, payment.customerId),
      }),
    db
      .insert(purchases)
      .values({
        paymentId: payment.paymentId,
        accountId: payment.accountId,
        productId: payment.productId,
        amount: payment.amount,
        currency: payment.currency,
        status: 'succeeded',
        plan: payment.plan,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: purchases.paymentId }),
  ])

/** The one statement a subscription event writes. */
const subscriptionWrite = (db: Database['Service'], change: SubscriptionChange, now: Date) => {
  const { accountId, subscriptionId, customerId, plan, at } = change
  const ofSubscription = and(
    eq(memberships.accountId, accountId),
    eq(memberships.subscriptionId, subscriptionId),
    subscriptionMayChange(at),
  )
  if (change.kind === 'active')
    return db
      .insert(memberships)
      .values({
        accountId,
        plan,
        until: change.until,
        status: 'active',
        subscriptionId,
        customerId,
        subscriptionEventAt: at,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: memberships.accountId,
        set: {
          plan,
          until: sql`max(case when ${eq(memberships.status, 'ended')} then 0 else ${memberships.until} end, ${change.until.getTime()})`,
          status: 'active',
          subscriptionId,
          customerId: customerOf(customerId),
          subscriptionEventAt: at,
          updatedAt: now,
        },
        setWhere: subscriptionMayChange(at),
      })
  if (change.kind === 'cancelled')
    return db
      .update(memberships)
      .set({ status: 'cancelled', subscriptionEventAt: at, updatedAt: now })
      .where(and(ofSubscription, eq(memberships.status, 'active')))
  return db
    .update(memberships)
    .set({
      status: 'ended',
      until: sql`min(${memberships.until}, ${now.getTime()})`,
      subscriptionEventAt: at,
      updatedAt: now,
    })
    .where(ofSubscription)
}

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
   * end; a running subscription keeps its plan and status) or lifetime, and its purchase row. The membership is
   * selected from the account's row, so an account gone meanwhile writes no membership; the purchase row's foreign key
   * then fails the whole batch, as before, which `fenced` answers as the store being unavailable (Dodo retries). */
  credit: (payment: Payment, now: Date) => fenced(() => creditBatch(db, payment, now)),
  /** Take a counted payment back, only while it still stands as succeeded: a week's comes off the end (never before
   * now; a lifetime membership keeps its none), a lifetime ends now. A payment Styld never counted changes nothing. */
  takeBack: (paymentId: string, status: TakenBack, now: Date) => {
    const payerOf = (plan: Payment['plan']) =>
      inArray(
        memberships.accountId,
        db
          .select({ accountId: purchases.accountId })
          .from(purchases)
          .where(and(eq(purchases.paymentId, paymentId), eq(purchases.status, 'succeeded'), eq(purchases.plan, plan))),
      )
    return query(() =>
      db.batch([
        db
          .update(memberships)
          .set({ until: sql`max(${now.getTime()}, ${memberships.until} - ${weekMillis})`, updatedAt: now })
          .where(and(isNotNull(memberships.until), payerOf('week'))),
        db
          .update(memberships)
          .set({ until: now, status: 'ended', updatedAt: now })
          .where(and(isNull(memberships.until), payerOf('lifetime'))),
        db
          .update(purchases)
          .set({ status, updatedAt: now })
          .where(and(eq(purchases.paymentId, paymentId), eq(purchases.status, 'succeeded'))),
      ]),
    )
  },
  /** Apply one subscription event. Running, it makes (or moves) the membership that subscription's, until the later of
   * its end and the current one; cancelled, it stops renewing and keeps its end; ended, its access stops now. A
   * running event for an account gone meanwhile fails on the foreign key, answered as the store being unavailable. */
  subscription: (change: SubscriptionChange, now: Date) =>
    fenced(() => subscriptionWrite(db, change, now)).pipe(Effect.asVoid),
  /** The operator's grant: lifetime, whatever the account had; granting again changes nothing. */
  grantLifetime: (accountId: string, now: Date) =>
    query(() =>
      db
        .insert(memberships)
        .values({ accountId, plan: 'lifetime', until: null, status: 'active', updatedAt: now })
        .onConflictDoUpdate({
          target: memberships.accountId,
          set: { plan: 'lifetime', until: null, status: 'active', updatedAt: now },
        }),
    ).pipe(Effect.asVoid),
})
