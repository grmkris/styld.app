import { Effect, Option, Schema } from 'effect'
import { Checkouts, type CheckoutRequest } from '../billing/Checkouts.ts'
import type { Deployment } from '../Config.ts'
import { broken, busy } from './Errors.ts'
import { httpProvider, type Fetch } from './Http.ts'

// Dodo Payments' checkout sessions (`POST /checkouts`, the `dodopayments` SDK 2.42's `checkoutSessions.create`), called
// directly so the Worker carries no SDK: one premium week in the cart, the person's email and name, the account in the
// metadata (the webhook credits it from there) and the account page to come back to. Nothing is charged here.

const provider = 'dodo'

/** Opening a checkout is one quick call; a slow one is retried by the person, it charges nothing. */
const deadline = '20 seconds'

const Session = Schema.Struct({ checkout_url: Schema.optionalKey(Schema.NullOr(Schema.String)) })

/** The checkout session's body.
 * @internal Exported for its tests. */
export const checkoutBody = (product: string, request: CheckoutRequest) => ({
  product_cart: [{ product_id: product, quantity: 1 }],
  ...(request.customer === null ? {} : { customer: request.customer }),
  metadata: { accountId: request.accountId },
  return_url: request.returnUrl,
})

/** Dodo's checkouts for the deployment's payments; a deployment without payments has none to open. */
export const makeDodoCheckouts = (billing: Deployment['Service']['billing'], fetch: Fetch) =>
  Checkouts.of({
    open: (request) => {
      if (Option.isNone(billing)) return Effect.fail(broken(provider))
      const { base, key, product } = billing.value
      const http = httpProvider({ provider, base, key, fetch })
      return Effect.gen(function* () {
        // Nothing is charged by opening a checkout, so a request that got no answer only did not get through.
        const response = yield* http.postJson('/checkouts', checkoutBody(product, request), 'busy')
        if (!response.ok) return yield* http.refusal(response)
        const session = yield* Schema.decodeUnknownEffect(Session)(yield* http.json(response, 'busy')).pipe(
          Effect.mapError(() => broken(provider)),
        )
        const url = session.checkout_url
        if (url === undefined || url === null) return yield* broken(provider)
        return { url }
      }).pipe(
        Effect.timeoutOrElse({ duration: deadline, orElse: () => Effect.fail(busy(provider)) }),
        Effect.withSpan('Styld.Dodo.checkout'),
      )
    },
  })
