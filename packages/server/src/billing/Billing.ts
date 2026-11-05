import { CurrentAccount, CurrentOperator, NotFound, type PlanName, plans, Unavailable } from '@styld/protocol'
import { Context, DateTime, Effect, Layer, Match, Option } from 'effect'
import { AccountLifecycle } from '../AccountLifecycle.ts'
import { Deployment } from '../Config.ts'
import { Database, logUnavailable, stored } from '../kernel/Db.ts'
import { type Balance, Holds } from '../usage/Holds.ts'
import { Checkouts } from './Checkouts.ts'
import { isActiveAt } from './Membership.ts'
import { isSignedDelivery, type WebhookHeaders } from './Signature.ts'
import { billingStore } from './Store.ts'
import { actionOf, type WebhookAction } from './Webhook.ts'

// Plans (owner, 4 November 2026): the person opens Dodo's checkout for a plan from the account page; Dodo's webhook,
// and only it, gives or moves the membership. The operator grants lifetime memberships by hand. A stage without Dodo's
// settings sells nothing: no checkout, no portal, no webhook.

/** The name Dodo shows on the checkout: the display name, else the email's local part, never empty.
 * @internal Exported for its tests. */
export const customerName = (displayName: string, email: string) => {
  const name = displayName.trim()
  if (name.length > 0) return name
  const local = email.split('@')[0] ?? ''
  return local.length > 0 ? local : email
}

/** How the webhook answered a delivery: its HTTP status. Dodo retries anything but a 2xx. */
export type WebhookAnswer = 200 | 400 | 401 | 404 | 503

/** The session's credits as `GET /api/credits` answers them. */
export interface Credits {
  readonly remaining: number
  readonly daily: number
  readonly free: number
  readonly membership: { readonly plan: PlanName; readonly until: string | null; readonly renews: boolean } | null
  readonly plansAvailable: boolean
  readonly manageable: boolean
}

export class Billing extends Context.Service<
  Billing,
  {
    /** The session's credits: left now, today's allowance, the free ones left, the active plan, and whether plans are
     * sold here and Dodo's portal knows the person. */
    readonly credits: () => Effect.Effect<Credits, Unavailable, CurrentAccount>
    /** A plan's checkout for the session's account. */
    readonly checkout: (
      plan: PlanName,
    ) => Effect.Effect<{ readonly url: string }, NotFound | Unavailable, CurrentAccount>
    /** Dodo's customer portal for the session's account, once a payment made it Dodo's customer. */
    readonly portal: () => Effect.Effect<{ readonly url: string }, NotFound | Unavailable, CurrentAccount>
    /** One webhook delivery, its raw body and signature headers: answered 2xx only once its change is in D1. */
    readonly webhook: (headers: WebhookHeaders, body: string) => Effect.Effect<WebhookAnswer>
    /** The operator's grant of a lifetime membership to the account an email signs in to. */
    readonly grant: (
      email: string,
    ) => Effect.Effect<{ readonly accountId: string }, NotFound | Unavailable, CurrentOperator>
  }
>()('@styld/server/billing/Billing') {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const { origin, billing } = yield* Deployment
      return makeBilling(
        { origin, billing },
        {
          holds: yield* Holds,
          checkouts: yield* Checkouts,
          lifecycle: yield* AccountLifecycle,
          db: yield* Database,
        },
      )
    }),
  )
}

const outcome = (name: string) => Effect.annotateCurrentSpan('styld.billing.outcome', name)

/** A delivery for an account that is gone (deleted since its checkout) or that Styld cannot find: answered, logged for
 * a refund by hand. */
const noAccount = Effect.gen(function* () {
  yield* outcome('accountGone')
  yield* Effect.logWarning('Styld.Billing a payment arrived for an account that is gone')
  return 200 as const
})

/** What a signed delivery asks, done: 200 once D1 has it (or when there is nothing to do), 400 for a body that cannot
 * be read. */
const carryOut = (store: ReturnType<typeof billingStore>, action: WebhookAction, at: Date) =>
  Match.value(action).pipe(
    Match.tagsExhaustive({
      unreadable: () => Effect.as(outcome('unreadable'), 400 as const),
      ignore: ({ reason }) => Effect.as(outcome(reason), 200 as const),
      credit: ({ payment, payer }) =>
        Effect.gen(function* () {
          const account = yield* store.accountOf(payer)
          if (Option.isNone(account)) return yield* noAccount
          yield* outcome(`credit.${payment.plan}`)
          yield* store.credit({ ...payment, accountId: account.value }, at)
          return 200 as const
        }),
      subscription: ({ change, payer }) =>
        Effect.gen(function* () {
          const account = yield* store.accountOf(payer)
          if (Option.isNone(account)) return yield* noAccount
          yield* outcome(`subscription.${change.kind}`)
          yield* store.subscription({ ...change, accountId: account.value }, at)
          return 200 as const
        }),
      takeBack: ({ paymentId, status }) =>
        Effect.as(Effect.andThen(outcome('takeBack'), store.takeBack(paymentId, status, at)), 200 as const),
    }),
  )

/** The credits as `GET /api/credits` answers them, from the account's balance at `now`. */
const creditsOf = (balance: Balance, now: Date, plansAvailable: boolean): Credits => ({
  remaining: balance.remaining,
  daily: balance.daily,
  free: balance.free,
  membership: Option.match(
    Option.filter(balance.membership, () => isActiveAt(balance.membership, now)),
    {
      onNone: () => null,
      onSome: ({ plan, until, status }) => ({
        plan,
        until: until === null ? null : until.toISOString(),
        renews: plans[plan].renews && status === 'active',
      }),
    },
  ),
  plansAvailable,
  manageable: plansAvailable && Option.exists(balance.membership, ({ customerId }) => customerId !== null),
})

/** Billing over the deployment's origin and payments, and the services it uses.
 * @internal Exported for its tests. */
export const makeBilling = (
  settings: Pick<Deployment['Service'], 'origin' | 'billing'>,
  services: {
    readonly holds: Holds['Service']
    readonly checkouts: Checkouts['Service']
    readonly lifecycle: Pick<AccountLifecycle['Service'], 'readAccount'>
    readonly db: Database['Service']
  },
) => {
  const { billing } = settings
  const { holds, checkouts, lifecycle } = services
  const store = billingStore(services.db)
  return Billing.of({
    credits: Effect.fn('Styld.Billing.credits')(function* () {
      const { accountId } = yield* CurrentAccount
      const balance = yield* holds.balance(accountId)
      return creditsOf(balance, DateTime.toDateUtc(yield* DateTime.now), Option.isSome(billing))
    }),
    checkout: Effect.fn('Styld.Billing.checkout')(function* (plan: PlanName) {
      if (Option.isNone(billing)) return yield* NotFound.make({})
      yield* Effect.annotateCurrentSpan('styld.billing.plan', plan)
      const account = yield* lifecycle.readAccount().pipe(Effect.mapError(() => Unavailable.make({})))
      // An account without an email address gives none, and Dodo asks for it on its page.
      return yield* checkouts
        .open({
          product: billing.value.products[plan],
          accountId: account.accountId,
          customer:
            account.email === null
              ? null
              : { email: account.email, name: customerName(account.displayName, account.email) },
          returnUrl: `${settings.origin}/account?premium=1#plans`,
        })
        .pipe(Effect.mapError(() => Unavailable.make({})))
    }),
    portal: Effect.fn('Styld.Billing.portal')(function* () {
      if (Option.isNone(billing)) return yield* NotFound.make({})
      const { accountId } = yield* CurrentAccount
      const balance = yield* holds.balance(accountId)
      const customer = Option.flatMapNullishOr(balance.membership, ({ customerId }) => customerId)
      if (Option.isNone(customer)) return yield* NotFound.make({})
      return yield* checkouts
        .portal(customer.value, `${settings.origin}/account#plans`)
        .pipe(Effect.mapError(() => Unavailable.make({})))
    }),
    webhook: Effect.fn('Styld.Billing.webhook')(
      function* (headers: WebhookHeaders, body: string) {
        if (Option.isNone(billing)) return 404 as const
        const now = yield* DateTime.now
        const signed = yield* isSignedDelivery(
          billing.value.webhookKey,
          headers,
          body,
          Math.floor(now.epochMilliseconds / 1000),
        )
        if (!signed) {
          yield* Effect.annotateCurrentSpan('styld.billing.outcome', 'badSignature')
          return 401 as const
        }
        const at = DateTime.toDateUtc(now)
        return yield* carryOut(store, actionOf(body, billing.value.products, at), at)
      },
      Effect.catchTag('StoreUnavailable', (error) => Effect.as(logUnavailable(error), 503 as const)),
    ),
    grant: Effect.fn('Styld.Billing.grant')(function* (email: string) {
      yield* CurrentOperator
      const account = yield* stored(store.accountOfEmail(email.trim().toLowerCase()))
      if (Option.isNone(account)) return yield* NotFound.make({})
      yield* stored(store.grantLifetime(account.value, yield* Effect.map(DateTime.now, DateTime.toDateUtc)))
      return { accountId: account.value }
    }),
  })
}
