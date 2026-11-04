import { Context, type Effect } from 'effect'
import type { ProviderError } from '../providers/Errors.ts'

/** One plan's checkout to open: the product, who pays, which account it is for and where Dodo sends the person back. */
export interface CheckoutRequest {
  readonly product: string
  readonly accountId: string
  /** Who pays; none when the account has no email address, and Dodo asks on its page. */
  readonly customer: { readonly email: string; readonly name: string } | null
  readonly returnUrl: string
}

/** The payment provider's hosted pages (`providers/Dodo.ts`; the server tests' fake): a checkout, and the customer
 * portal where a subscription is cancelled and receipts are read. Opening either charges nothing: payments and
 * changes reach Styld through the webhook alone. */
export class Checkouts extends Context.Service<
  Checkouts,
  {
    readonly open: (request: CheckoutRequest) => Effect.Effect<{ readonly url: string }, ProviderError>
    readonly portal: (customerId: string, returnUrl: string) => Effect.Effect<{ readonly url: string }, ProviderError>
  }
>()('@styld/server/billing/Checkouts') {}
