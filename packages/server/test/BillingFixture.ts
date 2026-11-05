import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { authMirror, memberships, purchases } from '@styld/db'
import { drizzle } from 'drizzle-orm/d1'
import { asc, eq } from 'drizzle-orm'
import { Effect, Exit, Schedule } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { billingStore, type Payment, type SubscriptionChange } from '../src/billing/Store.ts'
import { seedIdentity } from './IdentityFixture.ts'

// Test-only: every statement of the billing store on workerd's D1, in the order a member's payments, refunds and
// subscription events arrive, read back after each step (BillingAcceptance.ts holds what each must leave). The native
// stack has no Dodo webhook secret, so the webhook cannot deliver these through the edge.

/** The account the statements write for, seeded without a plan. */
const billingStoreAccount = 'native-free-billing-store'

/** The instant the statements run at, and Dodo's event times around it. */
export const billingNow = Date.UTC(2026, 10, 5, 12)

/** The statements' clock. */
const now = new Date(billingNow)

/** Local D1 answers SQLITE_BUSY for a while when another test writes: a statement is tried again until it is free. */
const whenFree = <A, E, R>(write: Effect.Effect<A, E, R>) =>
  write.pipe(Effect.retry({ times: 60, schedule: Schedule.spaced('200 millis') }))

const payment = (paymentId: string, customerId: string | null, plan: Payment['plan'] = 'week'): Payment => ({
  paymentId,
  accountId: billingStoreAccount,
  plan,
  productId: 'pdt_native',
  amount: 499,
  currency: 'EUR',
  customerId,
})

const event = (
  kind: SubscriptionChange['kind'],
  at: number,
  until = billingNow + 40 * 86_400_000,
): SubscriptionChange => ({
  accountId: billingStoreAccount,
  subscriptionId: 'sub_native',
  customerId: null,
  plan: 'monthly',
  kind,
  until: new Date(until),
  at: new Date(at),
})

/** `POST /test/billing/statements`: each statement run once, with the membership and purchases it leaves. */
export const billingRoutes = (database: QueryDatabaseClient) =>
  HttpRouter.add(
    'POST',
    '/test/billing/statements',
    Effect.gen(function* () {
      yield* whenFree(Effect.catchDefect(seedIdentity(database, billingStoreAccount), Effect.fail))
      const db = drizzle(yield* database.raw)
      const store = billingStore(db)
      const read = whenFree(
        Effect.tryPromise(async () => ({
          membership:
            (
              await db
                .select({
                  plan: memberships.plan,
                  until: memberships.until,
                  status: memberships.status,
                  subscriptionId: memberships.subscriptionId,
                  customerId: memberships.customerId,
                })
                .from(memberships)
                .where(eq(memberships.accountId, billingStoreAccount))
            )[0] ?? null,
          purchases: await db
            .select({ paymentId: purchases.paymentId, status: purchases.status })
            .from(purchases)
            .where(eq(purchases.accountId, billingStoreAccount))
            .orderBy(asc(purchases.paymentId)),
        })),
      )
      const steps: Array<{ readonly step: string; readonly state: Effect.Success<typeof read> }> = []
      const step = <E>(name: string, write: Effect.Effect<unknown, E>) =>
        Effect.gen(function* () {
          yield* whenFree(write)
          steps.push({ step: name, state: yield* read })
        })
      yield* step('week', store.credit(payment('pay_native_1', 'cus_native'), now))
      yield* step('week again', store.credit(payment('pay_native_1', 'cus_native'), now))
      yield* step('second week, no customer', store.credit(payment('pay_native_2', null), now))
      yield* step('second week refunded', store.takeBack('pay_native_2', 'refunded', now))
      yield* step('refunded again', store.takeBack('pay_native_2', 'disputed', now))
      yield* step('subscribed', store.subscription(event('active', billingNow + 1000), now))
      yield* step('cancelled', store.subscription(event('cancelled', billingNow + 2000), now))
      yield* step('ended', store.subscription(event('ended', billingNow + 3000), now))
      yield* step('older event', store.subscription(event('active', billingNow + 500), now))
      yield* step('granted', store.grantLifetime(billingStoreAccount, now))
      // An account gone meanwhile: the purchase's foreign key fails the batch, and nothing is written.
      const gone = yield* Effect.exit(
        store.credit({ ...payment('pay_native_gone', null), accountId: 'native-gone' }, now),
      )
      const goneRows = yield* whenFree(
        Effect.tryPromise(() =>
          db
            .select({ paymentId: purchases.paymentId })
            .from(purchases)
            .where(eq(purchases.paymentId, 'pay_native_gone')),
        ),
      )
      return yield* HttpServerResponse.json({
        steps,
        gone: { failed: Exit.isFailure(gone), rows: goneRows.length },
      })
    }).pipe(Effect.orDie),
  )

/** `GET /test/identity/auth-rows?subject=`: how many auth rows of every kind the account still has. */
export const authRowsRoute = (database: QueryDatabaseClient) =>
  HttpRouter.add(
    'GET',
    '/test/identity/auth-rows',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest
      const subject = new URL(request.url, 'http://local.invalid').searchParams.get('subject') ?? ''
      const db = drizzle(yield* database.raw)
      const counts = yield* Effect.forEach(Object.entries(authMirror), ([name, table]) =>
        Effect.map(
          Effect.tryPromise(() => db.$count(table, eq(table.subjectId, subject))),
          (count) => [name, count] as const,
        ),
      )
      return yield* HttpServerResponse.json(Object.fromEntries(counts))
    }).pipe(Effect.orDie),
  )
