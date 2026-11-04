import { createHmac, randomBytes } from 'node:crypto'
import * as Domain from '@alchemy.run/domain'
import { describe, expect, it } from '@effect/vitest'
import { Styld } from '@styld/domain/Styld.model'
import { CurrentAccount, dailyCredits, premiumWeek } from '@styld/protocol'
import * as WebCrypto from '@yielded/auth/WebCrypto'
import { drizzle } from 'drizzle-orm/d1'
import { DateTime, Effect, Layer, Option, Redacted } from 'effect'
import { makeAccountLifecycle } from '../src/AccountLifecycle.ts'
import { customerName, makeBilling } from '../src/billing/Billing.ts'
import type { CheckoutRequest } from '../src/billing/Checkouts.ts'
import { allowanceAt } from '../src/billing/Premium.ts'
import { isSignedDelivery, toleranceSeconds, webhookKeyOf } from '../src/billing/Signature.ts'
import { actionOf } from '../src/billing/Webhook.ts'
import { Database } from '../src/kernel/Db.ts'
import { checkoutBody, makeDodoCheckouts } from '../src/providers/Dodo.ts'
import { holdId, Holds } from '../src/usage/Holds.ts'
import { localD1 } from './LocalD1.ts'

// Styld Premium Week: Dodo's webhook, verified the Standard Webhooks way, is the only thing that credits a week; a
// payment delivered twice counts once, a refund or a lost dispute takes its week back once, and another brand's
// product is answered and left alone. The Wallet is the real aggregate in memory, D1 is SQLite with every migration.

const product = 'pdt_premium_week'
const day = 24 * 60 * 60 * 1000
const notUsed = () => Promise.reject(new Error('not used'))

/** A delivery signed with the reference algorithm (Node's HMAC), independent of the WebCrypto check under test. */
const signed = (key: Uint8Array, body: string, timestamp: number, id = 'msg_1') => ({
  id,
  timestamp: String(timestamp),
  signature: `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`,
})

const succeeded = (paymentId: string, accountId = 'ac_ana', productId = product) =>
  JSON.stringify({
    business_id: 'bus_1',
    type: 'payment.succeeded',
    timestamp: '2026-11-04T18:00:00Z',
    data: {
      payment_id: paymentId,
      total_amount: 499,
      currency: 'USD',
      metadata: { accountId },
      product_cart: [{ product_id: productId, quantity: 1 }],
    },
  })
const refunded = (paymentId: string) =>
  JSON.stringify({ type: 'refund.succeeded', data: { payment_id: paymentId, refund_id: 'ref_1', is_partial: false } })
const disputeLost = (paymentId: string) =>
  JSON.stringify({ type: 'dispute.lost', data: { payment_id: paymentId, dispute_id: 'dsp_1' } })

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
  it('credits only the stage’s premium week, for the account in its metadata', () => {
    expect(actionOf(succeeded('pay_1'), product)).toEqual({
      _tag: 'credit',
      payment: { paymentId: 'pay_1', accountId: 'ac_ana', productId: product, amount: 499, currency: 'USD' },
    })
    expect(actionOf(succeeded('pay_1', 'ac_ana', 'pdt_other_brand'), product)).toEqual({
      _tag: 'ignore',
      reason: 'otherProduct',
    })
    expect(actionOf(succeeded('pay_1', ''), product)).toEqual({ _tag: 'ignore', reason: 'noAccount' })
    expect(actionOf(JSON.stringify({ type: 'payment.failed', data: {} }), product)).toEqual({
      _tag: 'ignore',
      reason: 'otherEvent',
    })
    expect(actionOf(refunded('pay_1'), product)).toEqual({ _tag: 'takeBack', paymentId: 'pay_1', status: 'refunded' })
    expect(actionOf(disputeLost('pay_1'), product)).toEqual({
      _tag: 'takeBack',
      paymentId: 'pay_1',
      status: 'disputed',
    })
    expect(actionOf('not json', product)).toEqual({ _tag: 'unreadable' })
  })
})

describe('the premium end', () => {
  const now = new Date('2026-11-04T18:00:00Z')
  it('gives the premium allowance only before the end', () => {
    expect(allowanceAt(Option.none(), now)).toBe(dailyCredits)
    expect(allowanceAt(Option.some(new Date(now.getTime() + 1)), now)).toBe(premiumWeek.dailyCredits)
    expect(allowanceAt(Option.some(now), now)).toBe(dailyCredits)
  })
  it('names the customer by the display name, else the email’s local part', () => {
    expect(customerName(' Ana ', 'ana@example.com')).toBe('Ana')
    expect(customerName('  ', 'ana@example.com')).toBe('ana')
  })
})

/** Billing over a fresh database with Ana, the in-memory Wallet, and a checkout that records what it was asked. */
const over = (payments: 'on' | 'off' = 'on') => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 'r', '', 0);
    INSERT INTO styld_auth_identifiers (namespace, value, module_id, credential_id, subject_id, revision, verified_at, active)
      VALUES ('email', 'ana@example.com', 'm', 'c1', 'ac_ana', 'r', 1, 1);
  `)
  const key = new Uint8Array(randomBytes(24))
  const opened: Array<CheckoutRequest> = []
  const wallet = Styld.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory))
  const holds = Holds.layer.pipe(Layer.provide(Layer.mergeAll(wallet, Database.layer(database))))
  const billing = Effect.gen(function* () {
    const lifecycle = yield* makeAccountLifecycle(
      { database: drizzle(database), bucket: { list: notUsed, delete: notUsed }, queue: { send: notUsed } },
      { chats: () => Effect.void, providerFiles: () => Effect.void },
    ).pipe(Effect.provide(WebCrypto.layer))
    return makeBilling(
      {
        origin: 'https://styld.example',
        billing:
          payments === 'on'
            ? Option.some({ base: 'https://test.dodo', product, key: Redacted.make('sk'), webhookKey: key })
            : Option.none(),
      },
      {
        holds: yield* Holds,
        checkouts: {
          open: (request) => Effect.sync(() => (opened.push(request), { url: 'https://checkout.dodo/cks_1' })),
        },
        lifecycle,
        db: drizzle(database),
      },
    )
  })
  /** Deliver a body, signed now. */
  const deliver = (body: string, id = 'msg_1') =>
    Effect.gen(function* () {
      const now = Math.floor((yield* DateTime.now).epochMilliseconds / 1000)
      return yield* (yield* billing).webhook(signed(key, body, now, id), body)
    })
  const purchases = () => database.sqlite.prepare('SELECT payment_id, status FROM purchases ORDER BY payment_id').all()
  const premiumUntil = () =>
    database.sqlite.prepare("SELECT until FROM premium WHERE account_id = 'ac_ana'").get()?.['until']
  return { billing, deliver, purchases, premiumUntil, opened, layer: holds, database }
}

const asAna = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, CurrentAccount, { accountId: 'ac_ana', via: 'session' })

describe('the premium week', () => {
  it.effect('a payment delivered twice is one purchase and one week, and lifts today at once', () => {
    const { billing, deliver, purchases, premiumUntil, layer } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      yield* holds.reserve({ accountId: 'ac_ana', hold: holdId('photo', 'ph_1', 1), credits: 60 })
      const at = yield* DateTime.now
      const now = at.epochMilliseconds
      expect(yield* deliver(succeeded('pay_1'))).toBe(200)
      expect(yield* deliver(succeeded('pay_1'), 'msg_2')).toBe(200)
      expect(purchases()).toEqual([{ payment_id: 'pay_1', status: 'succeeded' }])
      expect(premiumUntil()).toBe(now + 7 * day)
      // Mid-day: today's 40 left are topped up by the difference, and a reservation past the free 100 is held.
      expect(yield* asAna((yield* billing).credits())).toEqual({
        remaining: 40 + premiumWeek.dailyCredits - dailyCredits,
        daily: premiumWeek.dailyCredits,
        premiumUntil: DateTime.formatIso(DateTime.add(at, { days: 7 })),
        premiumAvailable: true,
      })
      yield* holds.reserve({ accountId: 'ac_ana', hold: holdId('photo', 'ph_2', 1), credits: 300 })
      expect(yield* holds.remaining('ac_ana')).toBe(140)
      // A second week extends from the current end.
      expect(yield* deliver(succeeded('pay_2'), 'msg_3')).toBe(200)
      expect(premiumUntil()).toBe(now + 14 * day)
    }).pipe(Effect.provide(layer))
  })

  it.effect('a week bought after premium ended starts now, not from the old end', () => {
    const { deliver, premiumUntil, layer, database } = over()
    return Effect.gen(function* () {
      const now = (yield* DateTime.now).epochMilliseconds
      database.sqlite.prepare("INSERT INTO premium (account_id, until) VALUES ('ac_ana', ?)").run(now - 3 * day)
      expect(yield* deliver(succeeded('pay_1'))).toBe(200)
      expect(premiumUntil()).toBe(now + 7 * day)
    }).pipe(Effect.provide(layer))
  })

  it.effect('a refund and a lost dispute each take their week back once, never before now', () => {
    const { deliver, purchases, premiumUntil, layer } = over()
    return Effect.gen(function* () {
      const now = (yield* DateTime.now).epochMilliseconds
      yield* deliver(succeeded('pay_1'))
      yield* deliver(succeeded('pay_2'), 'msg_2')
      expect(yield* deliver(refunded('pay_1'), 'msg_3')).toBe(200)
      expect(yield* deliver(refunded('pay_1'), 'msg_4')).toBe(200)
      expect(premiumUntil()).toBe(now + 7 * day)
      expect(yield* deliver(disputeLost('pay_2'), 'msg_5')).toBe(200)
      expect(premiumUntil()).toBe(now)
      expect(purchases()).toEqual([
        { payment_id: 'pay_1', status: 'refunded' },
        { payment_id: 'pay_2', status: 'disputed' },
      ])
      // A refund of a payment Styld never counted moves nothing.
      expect(yield* deliver(refunded('pay_other'), 'msg_6')).toBe(200)
      expect(yield* (yield* Holds).balance('ac_ana')).toMatchObject({ daily: dailyCredits })
    }).pipe(Effect.provide(layer))
  })

  it.effect('another product, an unknown account, a bad signature and an unreadable body change nothing', () => {
    const { billing, deliver, purchases, premiumUntil, layer } = over()
    return Effect.gen(function* () {
      expect(yield* deliver(succeeded('pay_1', 'ac_ana', 'pdt_other_brand'))).toBe(200)
      expect(yield* deliver(succeeded('pay_2', 'ac_nobody'), 'msg_2')).toBe(200)
      const body = succeeded('pay_3')
      expect(yield* (yield* billing).webhook({ id: 'msg_3', timestamp: '1', signature: 'v1,AAAA' }, body)).toBe(401)
      expect(yield* deliver('{"type":', 'msg_4')).toBe(400)
      expect(purchases()).toEqual([])
      expect(premiumUntil()).toBeUndefined()
    }).pipe(Effect.provide(layer))
  })

  it.effect('opens a checkout for the session’s account, named by its email when it has no name', () => {
    const { billing, opened, layer } = over()
    return Effect.gen(function* () {
      expect(yield* asAna((yield* billing).checkout())).toEqual({ url: 'https://checkout.dodo/cks_1' })
      expect(opened).toEqual([
        {
          accountId: 'ac_ana',
          customer: { email: 'ana@example.com', name: 'ana' },
          returnUrl: 'https://styld.example/account?premium=1',
        },
      ])
    }).pipe(Effect.provide(layer))
  })

  it.effect('a stage without payments has no checkout and no webhook, and says so', () => {
    const { billing, deliver, opened, layer } = over('off')
    return Effect.gen(function* () {
      expect(yield* asAna((yield* billing).checkout()).pipe(Effect.flip)).toMatchObject({ _tag: 'NotFound' })
      expect(yield* deliver(succeeded('pay_1'))).toBe(404)
      expect(yield* asAna((yield* billing).credits())).toEqual({
        remaining: dailyCredits,
        daily: dailyCredits,
        premiumUntil: null,
        premiumAvailable: false,
      })
      expect(opened).toEqual([])
    }).pipe(Effect.provide(layer))
  })
})

describe('Dodo’s checkout session', () => {
  it('asks for one premium week, the customer, the account and the way back', () => {
    expect(
      checkoutBody(product, {
        accountId: 'ac_ana',
        customer: { email: 'ana@example.com', name: 'Ana' },
        returnUrl: 'https://styld.example/account?premium=1',
      }),
    ).toEqual({
      product_cart: [{ product_id: product, quantity: 1 }],
      customer: { email: 'ana@example.com', name: 'Ana' },
      metadata: { accountId: 'ac_ana' },
      return_url: 'https://styld.example/account?premium=1',
    })
  })

  it.effect('posts it with the key and answers the checkout url', () =>
    Effect.gen(function* () {
      const sent: Array<{ url: string; authorization: string | null; body: unknown }> = []
      const checkouts = makeDodoCheckouts(
        Option.some({
          base: 'https://test.dodo',
          product,
          key: Redacted.make('sk_test'),
          webhookKey: new Uint8Array(1),
        }),
        async (url, init) => {
          sent.push({
            url,
            authorization: new Headers(init.headers).get('authorization'),
            body: await new Response(init.body).json(),
          })
          return Response.json({ session_id: 'cks_1', checkout_url: 'https://checkout.dodo/cks_1' })
        },
      )
      const request = { accountId: 'ac_ana', customer: null, returnUrl: 'https://styld.example/account?premium=1' }
      expect(yield* checkouts.open(request)).toEqual({ url: 'https://checkout.dodo/cks_1' })
      expect(sent).toEqual([
        {
          url: 'https://test.dodo/checkouts',
          authorization: 'Bearer sk_test',
          body: {
            product_cart: [{ product_id: product, quantity: 1 }],
            metadata: { accountId: 'ac_ana' },
            return_url: 'https://styld.example/account?premium=1',
          },
        },
      ])
    }),
  )
})
