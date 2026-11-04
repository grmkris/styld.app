import { randomBytes } from 'node:crypto'
import * as Domain from '@alchemy.run/domain'
import { describe, expect, it } from '@effect/vitest'
import { Styld } from '@styld/domain/Styld.model'
import { CurrentAccount, CurrentOperator, freeCredits, LimitReached, memberDailyCredits } from '@styld/protocol'
import * as WebCrypto from '@yielded/auth/WebCrypto'
import { drizzle } from 'drizzle-orm/d1'
import { DateTime, Effect, Layer, Option, Redacted } from 'effect'
import { makeAccountLifecycle } from '../src/AccountLifecycle.ts'
import { makeBilling } from '../src/billing/Billing.ts'
import type { CheckoutRequest } from '../src/billing/Checkouts.ts'
import { Database } from '../src/kernel/Db.ts'
import { holdId, Holds } from '../src/usage/Holds.ts'
import {
  day,
  disputeLost,
  notUsed,
  products,
  refunded,
  signed,
  subscriptionEvent,
  succeeded,
} from './BillingDeliveries.ts'
import { localD1 } from './LocalD1.ts'

// Plans (owner, 4 November 2026): Dodo's webhook is the only thing that gives a week, a lifetime or a subscription's
// months; a payment delivered twice counts once, a refund or a lost dispute takes back what it gave once, a
// subscription event older than the last one applied changes nothing. Without a plan an account has its 3 free credits
// once. The operator grants lifetime by email. The Wallet is the real aggregate in memory, D1 is SQLite with every
// migration.

/** Billing over a fresh database with Ana, the in-memory Wallet, and Dodo's pages recording what they were asked. */
const over = (payments: 'on' | 'off' = 'on') => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 'r', '', 0);
    INSERT INTO styld_auth_identifiers (namespace, value, module_id, credential_id, subject_id, revision, verified_at, active)
      VALUES ('email', 'ana@example.com', 'm', 'c1', 'ac_ana', 'r', 1, 1);
  `)
  const key = new Uint8Array(randomBytes(24))
  const opened: Array<CheckoutRequest> = []
  const portals: Array<{ customerId: string; returnUrl: string }> = []
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
            ? Option.some({ base: 'https://test.dodo', products, key: Redacted.make('sk'), webhookKey: key })
            : Option.none(),
      },
      {
        holds: yield* Holds,
        checkouts: {
          open: (request) => Effect.sync(() => (opened.push(request), { url: 'https://checkout.dodo/cks_1' })),
          portal: (customerId, returnUrl) =>
            Effect.sync(() => (portals.push({ customerId, returnUrl }), { url: 'https://portal.dodo/session' })),
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
  const membership = () =>
    database.sqlite
      .prepare("SELECT plan, until, status, subscription_id, customer_id FROM memberships WHERE account_id = 'ac_ana'")
      .get()
  return { billing, deliver, purchases, membership, opened, portals, layer: holds, database }
}

const asAna = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, CurrentAccount, { accountId: 'ac_ana', via: 'session' })
const asOperator = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, CurrentOperator, { via: 'token' })

describe('an account without a plan', () => {
  it.effect('has 3 free credits once, then every paid action is refused until it chooses a plan', () => {
    const { billing, layer } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      expect(yield* asAna((yield* billing).credits())).toEqual({
        remaining: freeCredits,
        daily: 0,
        free: freeCredits,
        membership: null,
        plansAvailable: true,
        manageable: false,
      })
      yield* holds.reserve({ accountId: 'ac_ana', hold: holdId('photo', 'ph_1', 1), credits: 1 })
      yield* holds.reserve({ accountId: 'ac_ana', hold: holdId('photo', 'ph_2', 1), credits: 1 })
      // A failed cut-out gives its free credit back.
      yield* holds.settle('ac_ana', holdId('photo', 'ph_2', 1), 'failed')
      yield* holds.reserve({ accountId: 'ac_ana', hold: holdId('photo', 'ph_3', 1), credits: 2 })
      expect(yield* holds.remaining('ac_ana')).toBe(0)
      expect(
        yield* Effect.flip(holds.reserve({ accountId: 'ac_ana', hold: holdId('photo', 'ph_4', 1), credits: 1 })),
      ).toEqual(LimitReached.make({ limit: 'credits' }))
    }).pipe(Effect.provide(layer))
  })
})

describe('a week', () => {
  it.effect('a payment delivered twice is one purchase and one week, and lifts today at once', () => {
    const { billing, deliver, purchases, membership, layer } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      yield* holds.reserve({ accountId: 'ac_ana', hold: holdId('photo', 'ph_1', 1), credits: 2 })
      const at = yield* DateTime.now
      const now = at.epochMilliseconds
      expect(yield* deliver(succeeded('pay_1'))).toBe(200)
      expect(yield* deliver(succeeded('pay_1'), 'msg_2')).toBe(200)
      expect(purchases()).toEqual([{ payment_id: 'pay_1', status: 'succeeded' }])
      expect(membership()).toEqual({
        plan: 'week',
        until: now + 7 * day,
        status: 'active',
        subscription_id: null,
        customer_id: 'cus_ana',
      })
      expect(yield* asAna((yield* billing).credits())).toEqual({
        remaining: memberDailyCredits + 1,
        daily: memberDailyCredits,
        free: 1,
        membership: { plan: 'week', until: DateTime.formatIso(DateTime.add(at, { days: 7 })), renews: false },
        plansAvailable: true,
        manageable: true,
      })
      // A second week extends from the current end.
      expect(yield* deliver(succeeded('pay_2'), 'msg_3')).toBe(200)
      expect(membership()).toMatchObject({ until: now + 14 * day })
    }).pipe(Effect.provide(layer))
  })

  it.effect('a week paid in full by a discount code (a judge’s, $0) is a week like any other', () => {
    const { deliver, purchases, membership, layer } = over()
    return Effect.gen(function* () {
      const now = (yield* DateTime.now).epochMilliseconds
      const body = succeeded('pay_judge').replace('"total_amount":499', '"total_amount":0,"discount_id":"dsc_judge"')
      expect(body).toContain('"total_amount":0')
      expect(yield* deliver(body)).toBe(200)
      expect(purchases()).toEqual([{ payment_id: 'pay_judge', status: 'succeeded' }])
      expect(membership()).toMatchObject({ plan: 'week', until: now + 7 * day, status: 'active' })
    }).pipe(Effect.provide(layer))
  })

  it.effect('a week bought after the last one ended starts now, not from the old end', () => {
    const { deliver, membership, layer, database } = over()
    return Effect.gen(function* () {
      const now = (yield* DateTime.now).epochMilliseconds
      database.sqlite
        .prepare(
          "INSERT INTO memberships (account_id, plan, until, status, updated_at) VALUES ('ac_ana', 'monthly', ?, 'ended', 0)",
        )
        .run(now - 3 * day)
      expect(yield* deliver(succeeded('pay_1'))).toBe(200)
      expect(membership()).toMatchObject({ plan: 'week', until: now + 7 * day, status: 'active' })
    }).pipe(Effect.provide(layer))
  })

  it.effect('a refund and a lost dispute each take their week back once, never before now', () => {
    const { deliver, purchases, membership, layer } = over()
    return Effect.gen(function* () {
      const now = (yield* DateTime.now).epochMilliseconds
      yield* deliver(succeeded('pay_1'))
      yield* deliver(succeeded('pay_2'), 'msg_2')
      expect(yield* deliver(refunded('pay_1'), 'msg_3')).toBe(200)
      expect(yield* deliver(refunded('pay_1'), 'msg_4')).toBe(200)
      expect(membership()).toMatchObject({ until: now + 7 * day })
      expect(yield* deliver(disputeLost('pay_2'), 'msg_5')).toBe(200)
      expect(membership()).toMatchObject({ until: now })
      expect(purchases()).toEqual([
        { payment_id: 'pay_1', status: 'refunded' },
        { payment_id: 'pay_2', status: 'disputed' },
      ])
      // A refund of a payment Styld never counted moves nothing.
      expect(yield* deliver(refunded('pay_other'), 'msg_6')).toBe(200)
      expect(yield* (yield* Holds).balance('ac_ana')).toMatchObject({ daily: 0 })
    }).pipe(Effect.provide(layer))
  })
})

describe('lifetime', () => {
  it.effect('never ends: a week and a subscription leave it alone, and only its own refund ends it', () => {
    const { billing, deliver, purchases, membership, layer } = over()
    return Effect.gen(function* () {
      const now = (yield* DateTime.now).epochMilliseconds
      expect(yield* deliver(succeeded('pay_life', 'ac_ana', products.lifetime))).toBe(200)
      expect(membership()).toEqual({
        plan: 'lifetime',
        until: null,
        status: 'active',
        subscription_id: null,
        customer_id: 'cus_ana',
      })
      expect(yield* asAna((yield* billing).credits())).toMatchObject({
        daily: memberDailyCredits,
        membership: { plan: 'lifetime', until: null, renews: false },
      })
      expect(yield* deliver(succeeded('pay_week'), 'msg_2')).toBe(200)
      expect(yield* deliver(subscriptionEvent('subscription.active'), 'msg_3')).toBe(200)
      expect(yield* deliver(subscriptionEvent('subscription.expired'), 'msg_4')).toBe(200)
      expect(membership()).toMatchObject({ plan: 'lifetime', until: null, status: 'active' })
      // The week's refund has no end to take a week off.
      expect(yield* deliver(refunded('pay_week'), 'msg_5')).toBe(200)
      expect(membership()).toMatchObject({ plan: 'lifetime', until: null })
      expect(yield* deliver(refunded('pay_life'), 'msg_6')).toBe(200)
      expect(yield* deliver(refunded('pay_life'), 'msg_7')).toBe(200)
      expect(membership()).toMatchObject({ plan: 'lifetime', until: now, status: 'ended' })
      expect(purchases()).toEqual([
        { payment_id: 'pay_life', status: 'refunded' },
        { payment_id: 'pay_week', status: 'refunded' },
      ])
      expect(yield* asAna((yield* billing).credits())).toMatchObject({ daily: 0, membership: null })
    }).pipe(Effect.provide(layer))
  })
})

describe('a subscription', () => {
  const firstEnd = Date.parse('2026-12-04T18:00:00Z') + day
  const secondEnd = Date.parse('2027-01-04T18:00:00Z') + day

  it.effect('runs until its next billing date and a day, renews, and a repeated or older event changes nothing', () => {
    const { billing, deliver, membership, layer } = over()
    return Effect.gen(function* () {
      expect(yield* deliver(subscriptionEvent('subscription.active'))).toBe(200)
      expect(yield* deliver(subscriptionEvent('subscription.active'), 'msg_2')).toBe(200)
      expect(membership()).toEqual({
        plan: 'monthly',
        until: firstEnd,
        status: 'active',
        subscription_id: 'sub_1',
        customer_id: 'cus_ana',
      })
      expect(yield* asAna((yield* billing).credits())).toMatchObject({
        daily: memberDailyCredits,
        membership: { plan: 'monthly', until: '2026-12-05T18:00:00.000Z', renews: true },
        manageable: true,
      })
      const renewed = { timestamp: '2026-12-04T18:00:05Z', nextBilling: '2027-01-04T18:00:00Z' }
      expect(yield* deliver(subscriptionEvent('subscription.renewed', renewed), 'msg_3')).toBe(200)
      expect(membership()).toMatchObject({ until: secondEnd, status: 'active' })
      // An on_hold from before the renewal, delivered late, does not end it.
      expect(
        yield* deliver(subscriptionEvent('subscription.on_hold', { timestamp: '2026-12-01T00:00:00Z' }), 'msg_4'),
      ).toBe(200)
      expect(membership()).toMatchObject({ until: secondEnd, status: 'active' })
    }).pipe(Effect.provide(layer))
  })

  it.effect('cancelled keeps access until its end; expired, failed or on hold ends it at once', () => {
    const { billing, deliver, membership, layer } = over()
    return Effect.gen(function* () {
      const now = (yield* DateTime.now).epochMilliseconds
      yield* deliver(subscriptionEvent('subscription.active'))
      expect(
        yield* deliver(subscriptionEvent('subscription.cancelled', { timestamp: '2026-11-10T00:00:00Z' }), 'msg_2'),
      ).toBe(200)
      expect(membership()).toMatchObject({ until: firstEnd, status: 'cancelled' })
      expect(yield* asAna((yield* billing).credits())).toMatchObject({
        daily: memberDailyCredits,
        membership: { plan: 'monthly', renews: false },
      })
      expect(
        yield* deliver(subscriptionEvent('subscription.expired', { timestamp: '2026-12-05T18:00:00Z' }), 'msg_3'),
      ).toBe(200)
      expect(membership()).toMatchObject({ until: now, status: 'ended' })
      expect(yield* asAna((yield* billing).credits())).toMatchObject({ daily: 0, membership: null })
      // Subscribing again starts it again.
      const again = { timestamp: '2026-12-06T00:00:00Z', nextBilling: '2027-01-06T00:00:00Z' }
      expect(yield* deliver(subscriptionEvent('subscription.active', again), 'msg_4')).toBe(200)
      expect(membership()).toMatchObject({ until: Date.parse('2027-01-06T00:00:00Z') + day, status: 'active' })
    }).pipe(Effect.provide(layer))
  })

  it.effect('without metadata it finds the account by the customer’s email; a yearly one is a year', () => {
    const { deliver, membership, layer } = over()
    return Effect.gen(function* () {
      const yearly = { accountId: null, productId: products.yearly, nextBilling: '2027-11-04T18:00:00Z' }
      expect(yield* deliver(subscriptionEvent('subscription.active', yearly))).toBe(200)
      expect(membership()).toMatchObject({ plan: 'yearly', until: Date.parse('2027-11-04T18:00:00Z') + day })
    }).pipe(Effect.provide(layer))
  })
})

describe('the webhook', () => {
  it.effect('another product, an unknown account, a bad signature and an unreadable body change nothing', () => {
    const { billing, deliver, purchases, membership, layer } = over()
    return Effect.gen(function* () {
      expect(yield* deliver(succeeded('pay_1', 'ac_ana', 'pdt_other_brand'))).toBe(200)
      expect(yield* deliver(succeeded('pay_2', 'ac_nobody', products.week, null, 'nobody@example.com'), 'msg_2')).toBe(
        200,
      )
      const body = succeeded('pay_3')
      expect(yield* (yield* billing).webhook({ id: 'msg_3', timestamp: '1', signature: 'v1,AAAA' }, body)).toBe(401)
      expect(yield* deliver('{"type":', 'msg_4')).toBe(400)
      expect(purchases()).toEqual([])
      expect(membership()).toBeUndefined()
    }).pipe(Effect.provide(layer))
  })
})

describe('checkout, portal and the operator’s grant', () => {
  it.effect('opens each plan’s checkout for the session’s account, named by its email when it has no name', () => {
    const { billing, opened, layer } = over()
    return Effect.gen(function* () {
      expect(yield* asAna((yield* billing).checkout('yearly'))).toEqual({ url: 'https://checkout.dodo/cks_1' })
      yield* asAna((yield* billing).checkout('week'))
      expect(opened).toEqual([
        {
          product: products.yearly,
          accountId: 'ac_ana',
          customer: { email: 'ana@example.com', name: 'ana' },
          returnUrl: 'https://styld.example/account?premium=1#plans',
        },
        {
          product: products.week,
          accountId: 'ac_ana',
          customer: { email: 'ana@example.com', name: 'ana' },
          returnUrl: 'https://styld.example/account?premium=1#plans',
        },
      ])
    }).pipe(Effect.provide(layer))
  })

  it.effect('opens the customer portal only once a payment made the person Dodo’s customer', () => {
    const { billing, deliver, portals, layer } = over()
    return Effect.gen(function* () {
      expect(yield* asAna((yield* billing).portal()).pipe(Effect.flip)).toMatchObject({ _tag: 'NotFound' })
      yield* deliver(subscriptionEvent('subscription.active'))
      expect(yield* asAna((yield* billing).portal())).toEqual({ url: 'https://portal.dodo/session' })
      expect(portals).toEqual([{ customerId: 'cus_ana', returnUrl: 'https://styld.example/account#plans' }])
    }).pipe(Effect.provide(layer))
  })

  it.effect('the operator grants lifetime by email, once however often it asks', () => {
    const { billing, membership, layer } = over()
    return Effect.gen(function* () {
      expect(yield* asOperator((yield* billing).grant(' Ana@Example.com '))).toEqual({ accountId: 'ac_ana' })
      expect(yield* asOperator((yield* billing).grant('ana@example.com'))).toEqual({ accountId: 'ac_ana' })
      expect(membership()).toMatchObject({ plan: 'lifetime', until: null, status: 'active' })
      expect(yield* asOperator((yield* billing).grant('nobody@example.com')).pipe(Effect.flip)).toMatchObject({
        _tag: 'NotFound',
      })
    }).pipe(Effect.provide(layer))
  })

  it.effect('a stage without payments has no checkout, no portal and no webhook, and says so', () => {
    const { billing, deliver, opened, layer } = over('off')
    return Effect.gen(function* () {
      expect(yield* asAna((yield* billing).checkout('week')).pipe(Effect.flip)).toMatchObject({ _tag: 'NotFound' })
      expect(yield* asAna((yield* billing).portal()).pipe(Effect.flip)).toMatchObject({ _tag: 'NotFound' })
      expect(yield* deliver(succeeded('pay_1'))).toBe(404)
      expect(yield* asAna((yield* billing).credits())).toEqual({
        remaining: freeCredits,
        daily: 0,
        free: freeCredits,
        membership: null,
        plansAvailable: false,
        manageable: false,
      })
      expect(opened).toEqual([])
    }).pipe(Effect.provide(layer))
  })
})
