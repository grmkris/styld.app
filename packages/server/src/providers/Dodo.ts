import { Effect, Option, Schema } from 'effect'
import { Checkouts, type CheckoutRequest } from '../billing/Checkouts.ts'
import type { Deployment } from '../Config.ts'
import { broken, busy, type ProviderError } from './Errors.ts'
import { httpProvider, type Fetch } from './Http.ts'

// Dodo Payments' hosted pages, called directly so the Worker carries no SDK. A checkout session (`POST /checkouts`, the
// `dodopayments` SDK 2.42's `checkoutSessions.create`): one plan's product in the cart (a subscription product makes a
// subscription), the person's email and name, the account in the metadata (the webhook credits it from there), the
// account page to come back to, and discount codes allowed so the owner can hand one out. A customer portal session
// (`POST /customers/{id}/customer-portal/session`, `customers.customerPortal.create`), where the person cancels a
// subscription and reads receipts. Nothing is charged here.

const provider = 'dodo'

/** Opening a page is one quick call; a slow one is retried by the person, it charges nothing. */
const deadline = '20 seconds'

const Session = Schema.Struct({ checkout_url: Schema.optionalKey(Schema.NullOr(Schema.String)) })
const PortalSession = Schema.Struct({ link: Schema.String })

/** The checkout session's body.
 * @internal Exported for its tests. */
export const checkoutBody = (request: CheckoutRequest) => ({
  product_cart: [{ product_id: request.product, quantity: 1 }],
  ...(request.customer === null ? {} : { customer: request.customer }),
  metadata: { accountId: request.accountId },
  return_url: request.returnUrl,
  feature_flags: { allow_discount_code: true },
})

/** Dodo's pages for the deployment's payments; a deployment without payments has none to open. */
export const makeDodoCheckouts = (billing: Deployment['Service']['billing'], fetch: Fetch) => {
  const call = <A>(name: string, run: (http: ReturnType<typeof httpProvider>) => Effect.Effect<A, ProviderError>) => {
    if (Option.isNone(billing)) return Effect.fail(broken(provider))
    const { base, key } = billing.value
    return run(httpProvider({ provider, base, key, fetch })).pipe(
      Effect.timeoutOrElse({ duration: deadline, orElse: () => Effect.fail(busy(provider)) }),
      Effect.withSpan(name),
    )
  }
  return Checkouts.of({
    open: (request) =>
      call('Styld.Dodo.checkout', (http) =>
        Effect.gen(function* () {
          // Nothing is charged by opening a checkout, so a request that got no answer only did not get through.
          const response = yield* http.postJson('/checkouts', checkoutBody(request), 'busy')
          if (!response.ok) return yield* http.refusal(response)
          const session = yield* Schema.decodeUnknownEffect(Session)(yield* http.json(response, 'busy')).pipe(
            Effect.mapError(() => broken(provider)),
          )
          const url = session.checkout_url
          if (url === undefined || url === null) return yield* broken(provider)
          return { url }
        }),
      ),
    portal: (customerId, returnUrl) =>
      call('Styld.Dodo.portal', (http) =>
        Effect.gen(function* () {
          const path = `/customers/${encodeURIComponent(customerId)}/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}`
          const response = yield* http.postJson(path, {}, 'busy')
          if (!response.ok) return yield* http.refusal(response)
          const session = yield* Schema.decodeUnknownEffect(PortalSession)(yield* http.json(response, 'busy')).pipe(
            Effect.mapError(() => broken(provider)),
          )
          return { url: session.link }
        }),
      ),
  })
}
