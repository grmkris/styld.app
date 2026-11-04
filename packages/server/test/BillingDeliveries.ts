import { createHmac } from 'node:crypto'

// Dodo's webhook deliveries for the billing tests (`Billing.test.ts`, `Memberships.test.ts`): bodies shaped as the
// `dodopayments` SDK 2.42's `WebhookPayload`, and a signature made with the reference algorithm.

export const products = { week: 'pdt_week', monthly: 'pdt_month', yearly: 'pdt_year', lifetime: 'pdt_life' }
export const day = 24 * 60 * 60 * 1000
export const notUsed = () => Promise.reject(new Error('not used'))

/** A delivery signed with the reference algorithm (Node's HMAC), independent of the WebCrypto check under test. */
export const signed = (key: Uint8Array, body: string, timestamp: number, id = 'msg_1') => ({
  id,
  timestamp: String(timestamp),
  signature: `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`,
})

export const succeeded = (
  paymentId: string,
  accountId = 'ac_ana',
  productId = products.week,
  subscriptionId: string | null = null,
  email = 'Ana@example.com',
) =>
  JSON.stringify({
    business_id: 'bus_1',
    type: 'payment.succeeded',
    timestamp: '2026-11-04T18:00:00Z',
    data: {
      payment_id: paymentId,
      total_amount: 499,
      currency: 'USD',
      metadata: { accountId },
      customer: { customer_id: 'cus_ana', email, name: 'Ana' },
      subscription_id: subscriptionId,
      product_cart: [{ product_id: productId, quantity: 1 }],
    },
  })
export const refunded = (paymentId: string) =>
  JSON.stringify({ type: 'refund.succeeded', data: { payment_id: paymentId, refund_id: 'ref_1', is_partial: false } })
export const disputeLost = (paymentId: string) =>
  JSON.stringify({ type: 'dispute.lost', data: { payment_id: paymentId, dispute_id: 'dsp_1' } })

export const subscriptionEvent = (
  type: string,
  options: {
    readonly timestamp?: string
    readonly nextBilling?: string
    readonly productId?: string
    readonly accountId?: string | null
    readonly status?: string
  } = {},
) =>
  JSON.stringify({
    business_id: 'bus_1',
    type,
    timestamp: options.timestamp ?? '2026-11-04T18:00:00Z',
    data: {
      payload_type: 'Subscription',
      subscription_id: 'sub_1',
      product_id: options.productId ?? products.monthly,
      status: options.status ?? 'active',
      next_billing_date: options.nextBilling ?? '2026-12-04T18:00:00Z',
      metadata: options.accountId === null ? {} : { accountId: options.accountId ?? 'ac_ana' },
      customer: { customer_id: 'cus_ana', email: 'Ana@Example.com', name: 'Ana' },
    },
  })
