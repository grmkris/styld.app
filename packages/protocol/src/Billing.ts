import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { NotFound, Unavailable } from './Errors.ts'
import { Operation } from './Ids.ts'
import { SessionAccount } from './Session.ts'

// Styld Premium Week (owner, 4 November 2026): one payment, through Dodo Payments as merchant of record, gives the
// premium daily allowance for seven days from the purchase; buying again extends from the current end. Free stays the
// daily allowance, and no card is ever asked for.

/** The signed-in person's credits: what is left today, today's allowance, until when premium lasts (an ISO instant),
 * and whether this deployment sells premium at all. */
export const CreditBalance = Schema.Struct({
  remaining: Schema.Int,
  daily: Schema.Int,
  premiumUntil: Schema.NullOr(Schema.String),
  premiumAvailable: Schema.Boolean,
})
export type CreditBalance = typeof CreditBalance.Type

/** Where the browser goes to pay: Dodo's hosted checkout. */
export const Checkout = Schema.Struct({ url: Schema.String })
export type Checkout = typeof Checkout.Type

/** The person's credits and the premium week's checkout. A deployment without payments answers `NotFound` to the
 * checkout. */
export class BillingApi extends HttpApiGroup.make('billing')
  .add(HttpApiEndpoint.get('credits', '/credits', { success: CreditBalance, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('checkout', '/billing/checkout', {
      payload: Operation,
      success: Checkout,
      error: [NotFound, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
