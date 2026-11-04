import { randomBytes } from 'node:crypto'
import { describe, expect, it } from '@effect/vitest'
import { memberDailyCredits } from '@styld/protocol'
import { Effect, Option, Redacted } from 'effect'
import { customerName } from '../src/billing/Billing.ts'
import { allowanceAt } from '../src/billing/Membership.ts'
import { isSignedDelivery, toleranceSeconds, webhookKeyOf } from '../src/billing/Signature.ts'
import { actionOf } from '../src/billing/Webhook.ts'
import { checkoutBody, makeDodoCheckouts } from '../src/providers/Dodo.ts'
import { day, disputeLost, products, refunded, signed, subscriptionEvent, succeeded } from './BillingDeliveries.ts'

// Plans (owner, 4 November 2026): what a signed delivery of Dodo's webhook asks for, verified the Standard Webhooks
// way; another brand's product and a subscription's own payments are left alone; the members' allowance; and Dodo's
// pages. The deliveries carried out against D1 and the Wallet are `Memberships.test.ts`.

describe('the webhook signature', () => {
  it.effect('accepts the Standard Webhooks reference vector', () =>
    Effect.gen(function* () {
      const key = Option.getOrThrow(webhookKeyOf('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'))
      const headers = {
        id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
        timestamp: '1614265330',
        signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
      }
      expect(yield* isSignedDelivery(key, headers, '{"test": 2432232314}', 1614265330)).toBe(true)
      // One changed byte of the body, or a signature among others while a secret rotates.
      expect(yield* isSignedDelivery(key, headers, '{"test": 2432232315}', 1614265330)).toBe(false)
      const rotating = { ...headers, signature: `v1,bm90IGl0 ${headers.signature}` }
      expect(yield* isSignedDelivery(key, rotating, '{"test": 2432232314}', 1614265330)).toBe(true)
    }),
  )

  it.effect('refuses another key, a missing header, an old or future timestamp and other versions', () =>
    Effect.gen(function* () {
      const key = new Uint8Array(randomBytes(24))
      const now = 1_800_000_000
      const body = '{"type":"payment.succeeded"}'
      const good = signed(key, body, now)
      expect(yield* isSignedDelivery(key, good, body, now)).toBe(true)
      expect(yield* isSignedDelivery(new Uint8Array(randomBytes(24)), good, body, now)).toBe(false)
      expect(yield* isSignedDelivery(key, { ...good, id: undefined }, body, now)).toBe(false)
      expect(yield* isSignedDelivery(key, { ...good, id: 'msg_2' }, body, now)).toBe(false)
      expect(yield* isSignedDelivery(key, good, body, now + toleranceSeconds + 1)).toBe(false)
      expect(yield* isSignedDelivery(key, good, body, now - toleranceSeconds - 1)).toBe(false)
      expect(
        yield* isSignedDelivery(key, { ...good, signature: good.signature.replace('v1,', 'v2,') }, body, now),
      ).toBe(false)
    }),
  )

  it('reads only a whsec_ secret with a key in it', () => {
    expect(Option.isSome(webhookKeyOf('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'))).toBe(true)
    expect(Option.isNone(webhookKeyOf('whsec_'))).toBe(true)
    expect(Option.isNone(webhookKeyOf('whsec_not base64!'))).toBe(true)
  })
})

describe('what a delivery asks for', () => {
  const at = new Date('2026-11-04T19:00:00Z')
  const ana = { accountId: 'ac_ana', subscriptionId: null, email: 'ana@example.com' }
  it('credits a week or a lifetime of the stage’s products, for the account in its metadata', () => {
    expect(actionOf(succeeded('pay_1'), products, at)).toEqual({
      _tag: 'credit',
      payment: {
        paymentId: 'pay_1',
        plan: 'week',
        productId: products.week,
        amount: 499,
        currency: 'USD',
        customerId: 'cus_ana',
      },
      payer: ana,
    })
    expect(actionOf(succeeded('pay_2', 'ac_ana', products.lifetime), products, at)).toMatchObject({
      _tag: 'credit',
      payment: { plan: 'lifetime', productId: products.lifetime },
    })
    expect(actionOf(succeeded('pay_1', '', products.week), products, at)).toMatchObject({
      _tag: 'credit',
      payer: { accountId: null, email: 'ana@example.com' },
    })
  })
  it('leaves other brands’ products, a subscription’s own payments and other events alone', () => {
    expect(actionOf(succeeded('pay_1', 'ac_ana', 'pdt_other_brand'), products, at)).toEqual({
      _tag: 'ignore',
      reason: 'otherProduct',
    })
    expect(actionOf(succeeded('pay_1', 'ac_ana', products.monthly, 'sub_1'), products, at)).toEqual({
      _tag: 'ignore',
      reason: 'subscriptionPayment',
    })
    expect(actionOf(subscriptionEvent('subscription.active', { productId: 'pdt_other_brand' }), products, at)).toEqual({
      _tag: 'ignore',
      reason: 'otherProduct',
    })
    expect(actionOf(subscriptionEvent('subscription.paused'), products, at)).toEqual({
      _tag: 'ignore',
      reason: 'otherEvent',
    })
    expect(actionOf(JSON.stringify({ type: 'payment.failed', data: {} }), products, at)).toEqual({
      _tag: 'ignore',
      reason: 'otherEvent',
    })
    expect(actionOf('not json', products, at)).toEqual({ _tag: 'unreadable' })
  })
  it('reads a subscription event as its plan, its end with a day’s grace and when it happened', () => {
    expect(actionOf(subscriptionEvent('subscription.renewed'), products, at)).toEqual({
      _tag: 'subscription',
      change: {
        subscriptionId: 'sub_1',
        customerId: 'cus_ana',
        plan: 'monthly',
        kind: 'active',
        until: new Date(Date.parse('2026-12-04T18:00:00Z') + day),
        at: new Date('2026-11-04T18:00:00Z'),
      },
      payer: { accountId: 'ac_ana', subscriptionId: 'sub_1', email: 'ana@example.com' },
    })
    expect(actionOf(subscriptionEvent('subscription.cancelled'), products, at)).toMatchObject({
      change: { kind: 'cancelled' },
    })
    for (const type of ['subscription.expired', 'subscription.failed', 'subscription.on_hold'])
      expect(actionOf(subscriptionEvent(type, { productId: products.yearly }), products, at)).toMatchObject({
        change: { kind: 'ended', plan: 'yearly' },
      })
  })
  it('takes back what a refund or a lost dispute names', () => {
    expect(actionOf(refunded('pay_1'), products, at)).toEqual({
      _tag: 'takeBack',
      paymentId: 'pay_1',
      status: 'refunded',
    })
    expect(actionOf(disputeLost('pay_1'), products, at)).toEqual({
      _tag: 'takeBack',
      paymentId: 'pay_1',
      status: 'disputed',
    })
  })
})

/** A week's membership as D1 has it. */
const membership = (until: Date | null, status: 'active' | 'cancelled' | 'ended' = 'active') =>
  Option.some({ plan: 'week' as const, until, status, customerId: null })

describe('the members’ allowance', () => {
  const now = new Date('2026-11-04T18:00:00Z')
  it('gives 500 a day only while a plan is active, and none without one', () => {
    expect(allowanceAt(Option.none(), now)).toBe(0)
    expect(allowanceAt(membership(new Date(now.getTime() + 1)), now)).toBe(memberDailyCredits)
    expect(allowanceAt(membership(new Date(now.getTime() + 1), 'cancelled'), now)).toBe(memberDailyCredits)
    expect(allowanceAt(membership(null), now)).toBe(memberDailyCredits)
    expect(allowanceAt(membership(now), now)).toBe(0)
    expect(allowanceAt(membership(new Date(now.getTime() + 1), 'ended'), now)).toBe(0)
  })
  it('names the customer by the display name, else the email’s local part', () => {
    expect(customerName(' Ana ', 'ana@example.com')).toBe('Ana')
    expect(customerName('  ', 'ana@example.com')).toBe('ana')
  })
})

describe('Dodo’s pages', () => {
  const request = {
    product: products.monthly,
    accountId: 'ac_ana',
    customer: { email: 'ana@example.com', name: 'Ana' },
    returnUrl: 'https://styld.example/account?premium=1#plans',
  }
  it('asks for one plan, the customer, the account, the way back and lets a discount code in', () => {
    expect(checkoutBody(request)).toEqual({
      product_cart: [{ product_id: products.monthly, quantity: 1 }],
      customer: { email: 'ana@example.com', name: 'Ana' },
      metadata: { accountId: 'ac_ana' },
      return_url: 'https://styld.example/account?premium=1#plans',
      feature_flags: { allow_discount_code: true },
    })
  })

  it.effect('posts a checkout and a portal session with the key and answers their urls', () =>
    Effect.gen(function* () {
      const sent: Array<{ url: string; authorization: string | null }> = []
      const checkouts = makeDodoCheckouts(
        Option.some({
          base: 'https://test.dodo',
          products,
          key: Redacted.make('sk_test'),
          webhookKey: new Uint8Array(1),
        }),
        async (url, init) => {
          sent.push({ url, authorization: new Headers(init.headers).get('authorization') })
          return url.includes('/customer-portal/')
            ? Response.json({ link: 'https://portal.dodo/session' })
            : Response.json({ session_id: 'cks_1', checkout_url: 'https://checkout.dodo/cks_1' })
        },
      )
      expect(yield* checkouts.open({ ...request, customer: null })).toEqual({ url: 'https://checkout.dodo/cks_1' })
      expect(yield* checkouts.portal('cus_ana', 'https://styld.example/account#plans')).toEqual({
        url: 'https://portal.dodo/session',
      })
      expect(sent).toEqual([
        { url: 'https://test.dodo/checkouts', authorization: 'Bearer sk_test' },
        {
          url: 'https://test.dodo/customers/cus_ana/customer-portal/session?return_url=https%3A%2F%2Fstyld.example%2Faccount%23plans',
          authorization: 'Bearer sk_test',
        },
      ])
    }),
  )
})
