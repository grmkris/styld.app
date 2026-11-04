import { Context, type Effect } from 'effect'
import type { ProviderError } from '../providers/Errors.ts'

/** One premium week's checkout to open: who pays, which account it credits and where Dodo sends the person back. */
export interface CheckoutRequest {
  readonly accountId: string
  /** Who pays; none when the account has no email address, and Dodo asks on its page. */
  readonly customer: { readonly email: string; readonly name: string } | null
  readonly returnUrl: string
}

/** The payment provider's hosted checkout (`providers/Dodo.ts`; the server tests' fake). Opening one charges nothing:
 * the payment is confirmed by the webhook alone. */
export class Checkouts extends Context.Service<
  Checkouts,
  { readonly open: (request: CheckoutRequest) => Effect.Effect<{ readonly url: string }, ProviderError> }
>()('@styld/server/billing/Checkouts') {}
