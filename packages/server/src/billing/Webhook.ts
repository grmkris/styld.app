import { type PlanName, planNames } from '@styld/protocol'
import { Option, Schema } from 'effect'
import type { Payer, Payment, SubscriptionChange, TakenBack } from './Store.ts'
import { graceMillis } from './Membership.ts'

// What Dodo's webhook events mean for Styld (the `dodopayments` SDK 2.42's `WebhookPayload`: `Payment`,
// `Subscription`, `Refund` and `Dispute`; only the fields read here are decoded). Dodo's business sells other brands'
// products too, so a delivery counts only when it is for one of the stage's plans; anything else is answered and left
// alone. A week or a lifetime is a one-time payment; a month or a year is a subscription, whose own events move the
// membership (its payments are left to them).

const Envelope = Schema.Struct({
  type: Schema.String,
  timestamp: Schema.optionalKey(Schema.String),
  data: Schema.Unknown,
})

const Metadata = Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)))
const Customer = Schema.optionalKey(
  Schema.NullOr(
    Schema.Struct({
      customer_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
      email: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
)

const PaymentData = Schema.Struct({
  payment_id: Schema.String,
  total_amount: Schema.Int,
  currency: Schema.String,
  metadata: Metadata,
  customer: Customer,
  subscription_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  product_cart: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({ product_id: Schema.String })))),
})

const SubscriptionData = Schema.Struct({
  subscription_id: Schema.String,
  product_id: Schema.String,
  status: Schema.optionalKey(Schema.String),
  next_billing_date: Schema.String,
  metadata: Metadata,
  customer: Customer,
})

const PaymentOf = Schema.Struct({ payment_id: Schema.String })

/** What one delivery asks of Styld. */
export type WebhookAction =
  | { readonly _tag: 'credit'; readonly payment: Omit<Payment, 'accountId'>; readonly payer: Payer }
  | { readonly _tag: 'subscription'; readonly change: Omit<SubscriptionChange, 'accountId'>; readonly payer: Payer }
  | { readonly _tag: 'takeBack'; readonly paymentId: string; readonly status: TakenBack }
  | { readonly _tag: 'ignore'; readonly reason: 'otherEvent' | 'otherProduct' | 'subscriptionPayment' }
  | { readonly _tag: 'unreadable' }

const unreadable: WebhookAction = { _tag: 'unreadable' }

type Products = Readonly<Record<PlanName, string>>

/** Which of the stage's plans a product is. */
const planOf = (products: Products, product: string) =>
  Option.fromUndefinedOr(planNames.find((plan) => products[plan] === product))

const isOneTime = (plan: PlanName): plan is 'week' | 'lifetime' => plan === 'week' || plan === 'lifetime'
const isSubscription = (plan: PlanName): plan is 'monthly' | 'yearly' => plan === 'monthly' || plan === 'yearly'

/** Who the delivery names, from its metadata's account and its customer. */
const payerOf = (
  metadata: Readonly<Record<string, unknown>> | null | undefined,
  customer: { readonly email?: string | null | undefined } | null | undefined,
  subscriptionId: string | null,
): Payer => {
  const accountId = metadata?.['accountId']
  const email = customer?.email?.trim().toLowerCase()
  return {
    accountId: typeof accountId === 'string' && accountId.length > 0 ? accountId : null,
    subscriptionId,
    email: email === undefined || email.length === 0 ? null : email,
  }
}

/** How a subscription event moves the membership; none for an event that does not. */
const subscriptionKind = (type: string, status: string | undefined) => {
  if (type === 'subscription.active' || type === 'subscription.renewed') return Option.some('active' as const)
  // A plan changed in the customer portal (a month to a year) runs on as the new product.
  if (type === 'subscription.plan_changed' && status === 'active') return Option.some('active' as const)
  if (type === 'subscription.cancelled') return Option.some('cancelled' as const)
  if (type === 'subscription.expired' || type === 'subscription.failed' || type === 'subscription.on_hold')
    return Option.some('ended' as const)
  return Option.none()
}

/** A payment: a week or a lifetime of the stage's, else nothing for Styld. */
const paymentAction = (data: unknown, products: Products): WebhookAction => {
  const decoded = Schema.decodeUnknownOption(PaymentData)(data)
  if (Option.isNone(decoded)) return unreadable
  const payment = decoded.value
  if (payment.subscription_id !== undefined && payment.subscription_id !== null)
    return { _tag: 'ignore', reason: 'subscriptionPayment' }
  // A payment's amount is never checked: a week paid in full by a discount code (a judge's, $0) is a week.
  const bought = (payment.product_cart ?? []).flatMap(({ product_id }) =>
    Option.toArray(
      Option.map(Option.filter(planOf(products, product_id), isOneTime), (plan) => ({ plan, productId: product_id })),
    ),
  )
  const first = bought[0]
  if (first === undefined) return { _tag: 'ignore', reason: 'otherProduct' }
  return {
    _tag: 'credit',
    payment: {
      paymentId: payment.payment_id,
      plan: first.plan,
      productId: first.productId,
      amount: payment.total_amount,
      currency: payment.currency,
      customerId: payment.customer?.customer_id ?? null,
    },
    payer: payerOf(payment.metadata, payment.customer, null),
  }
}

/** A subscription event of the stage's month or year, at `happened` (Dodo's clock, else `now`). */
const subscriptionAction = (type: string, data: unknown, products: Products, happened: Date): WebhookAction => {
  const decoded = Schema.decodeUnknownOption(SubscriptionData)(data)
  if (Option.isNone(decoded)) return unreadable
  const subscription = decoded.value
  const kind = subscriptionKind(type, subscription.status)
  if (Option.isNone(kind)) return { _tag: 'ignore', reason: 'otherEvent' }
  const plan = Option.filter(planOf(products, subscription.product_id), isSubscription)
  if (Option.isNone(plan)) return { _tag: 'ignore', reason: 'otherProduct' }
  const nextBilling = Date.parse(subscription.next_billing_date)
  if (Number.isNaN(nextBilling)) return unreadable
  return {
    _tag: 'subscription',
    change: {
      subscriptionId: subscription.subscription_id,
      customerId: subscription.customer?.customer_id ?? null,
      plan: plan.value,
      kind: kind.value,
      until: new Date(nextBilling + graceMillis),
      at: happened,
    },
    payer: payerOf(subscription.metadata, subscription.customer, subscription.subscription_id),
  }
}

/** What a signed delivery's body asks for, given the stage's plan products and the time it arrived. */
export const actionOf = (body: string, products: Products, now: Date): WebhookAction => {
  const envelope = Schema.decodeUnknownOption(Schema.fromJsonString(Envelope))(body)
  if (Option.isNone(envelope)) return unreadable
  const { type, data, timestamp } = envelope.value
  if (type === 'payment.succeeded') return paymentAction(data, products)
  if (type.startsWith('subscription.')) {
    const happened = timestamp === undefined ? Number.NaN : Date.parse(timestamp)
    return subscriptionAction(type, data, products, Number.isNaN(happened) ? now : new Date(happened))
  }
  if (type === 'refund.succeeded' || type === 'dispute.lost') {
    const of = Schema.decodeUnknownOption(PaymentOf)(data)
    if (Option.isNone(of)) return unreadable
    // A refund or a lost dispute of a payment Styld never counted (another product's, or a subscription's) finds no
    // purchase and moves nothing (`Store.ts`).
    return {
      _tag: 'takeBack',
      paymentId: of.value.payment_id,
      status: type === 'dispute.lost' ? 'disputed' : 'refunded',
    }
  }
  return { _tag: 'ignore', reason: 'otherEvent' }
}
