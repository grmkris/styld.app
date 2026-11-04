import { StyldApi } from '@styld/protocol'
import { Effect, Layer, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { Billing } from './Billing.ts'

/** The website's credits, a plan's checkout and the customer portal, for the session's account. */
export const billingHandlers = HttpApiBuilder.group(StyldApi, 'billing', (handlers) =>
  Effect.map(Billing, (billing) =>
    handlers
      .handle('credits', () => billing.credits())
      .handle('checkout', ({ payload }) => billing.checkout(payload.plan))
      .handle('portal', () => billing.portal()),
  ),
)

/** The operator's grant of a lifetime membership, which `tools/grant-membership.ts` calls. */
export const membershipGrantHandlers = HttpApiBuilder.group(StyldApi, 'membershipGrant', (handlers) =>
  Effect.map(Billing, (billing) => handlers.handle('grantMembership', ({ payload }) => billing.grant(payload.email))),
)

/** The path Dodo's webhook endpoints are registered at, in test and live mode alike. */
const webhookPath = '/api/billing/dodo/webhook'

/** `POST /api/billing/dodo/webhook`: outside the typed API, because the signature covers the raw body exactly as it
 * came. Neither the body nor its headers are logged. */
const receiveWebhook = Effect.map(Billing, (billing) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* request.text.pipe(Effect.option)
    if (Option.isNone(body)) return HttpServerResponse.empty({ status: 400 })
    const status = yield* billing.webhook(
      {
        id: request.headers['webhook-id'],
        timestamp: request.headers['webhook-timestamp'],
        signature: request.headers['webhook-signature'],
      },
      body.value,
    )
    return HttpServerResponse.empty({ status })
  }),
)

export const billingRoutes = Layer.unwrap(
  Effect.map(receiveWebhook, (handler) => HttpRouter.add('POST', webhookPath, handler)),
)
