import { Option, Schema } from 'effect'
import type { Payment, TakenBack } from './Store.ts'

// What Dodo's webhook events mean for Styld (the `dodopayments` SDK 2.42's `PaymentSucceededWebhookEvent`,
// `RefundSucceededWebhookEvent` and `DisputeLostWebhookEvent`; only the fields read here are decoded). Dodo's business
// sells other brands' products too, so a payment counts only when its cart holds the stage's premium week and its
// metadata names an account; anything else is answered and left alone.

const Envelope = Schema.Struct({ type: Schema.String, data: Schema.Unknown })

const PaymentData = Schema.Struct({
  payment_id: Schema.String,
  total_amount: Schema.Int,
  currency: Schema.String,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  product_cart: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({ product_id: Schema.String })))),
})

const PaymentOf = Schema.Struct({ payment_id: Schema.String })

/** What one delivery asks of Styld. */
export type WebhookAction =
  | { readonly _tag: 'credit'; readonly payment: Payment }
  | { readonly _tag: 'takeBack'; readonly paymentId: string; readonly status: TakenBack }
  | { readonly _tag: 'ignore'; readonly reason: 'otherEvent' | 'otherProduct' | 'noAccount' }
  | { readonly _tag: 'unreadable' }

const unreadable: WebhookAction = { _tag: 'unreadable' }

/** What a signed delivery's body asks for, for the stage's premium week `product`. */
export const actionOf = (body: string, product: string): WebhookAction => {
  const envelope = Schema.decodeUnknownOption(Schema.fromJsonString(Envelope))(body)
  if (Option.isNone(envelope)) return unreadable
  const { type, data } = envelope.value
  if (type === 'payment.succeeded') {
    const payment = Schema.decodeUnknownOption(PaymentData)(data)
    if (Option.isNone(payment)) return unreadable
    const { payment_id, total_amount, currency, metadata, product_cart } = payment.value
    if (!(product_cart ?? []).some(({ product_id }) => product_id === product))
      return { _tag: 'ignore', reason: 'otherProduct' }
    const accountId = metadata?.['accountId']
    if (typeof accountId !== 'string' || accountId.length === 0) return { _tag: 'ignore', reason: 'noAccount' }
    return {
      _tag: 'credit',
      payment: { paymentId: payment_id, accountId, productId: product, amount: total_amount, currency },
    }
  }
  if (type === 'refund.succeeded' || type === 'dispute.lost') {
    const of = Schema.decodeUnknownOption(PaymentOf)(data)
    if (Option.isNone(of)) return unreadable
    // A refund or a lost dispute of a payment Styld never counted (another product's) finds no purchase and moves
    // nothing (`Store.ts`).
    return {
      _tag: 'takeBack',
      paymentId: of.value.payment_id,
      status: type === 'dispute.lost' ? 'disputed' : 'refunded',
    }
  }
  return { _tag: 'ignore', reason: 'otherEvent' }
}
