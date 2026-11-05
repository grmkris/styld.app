import { expect } from 'bun:test'
import { freeCredits, memberDailyCredits } from '@styld/protocol'
import { client, send, seedAccounts, signIn } from './Accounts.ts'
import { billingNow } from './BillingFixture.ts'
import { nativeOperatorToken, operatorClient } from './OperatorToken.ts'

/** The account the billing journey reads its credits as: an id starting `native-free` is seeded without a plan
 * (`IdentityFixture.ts`). */
const billingAccount = 'native-free-billing'

/** A stage without Dodo's key and webhook secret (the native stack has neither) sells nothing, through the real edge:
 * `GET /api/credits` answers the 3 free credits and no daily allowance with plans unavailable, the checkout and the
 * portal are not there, and the webhook answers 404 to anything, so a delivery to a stage that cannot verify it never
 * counts. The operator's grant makes the account a member for life, whatever the stage sells. A stage with payments
 * is read back on the deployed preview with Dodo's test mode (docs/DEPLOYMENT.md). */
export const verifyBillingOff = async (origin: string, fixtures: string) => {
  await seedAccounts(fixtures, billingAccount)
  const owner = client(origin, await signIn(origin, billingAccount))
  const credits = await owner('/api/credits')
  expect(credits.status).toBe(200)
  expect(await credits.json()).toEqual({
    remaining: freeCredits,
    daily: 0,
    free: freeCredits,
    membership: null,
    plansAvailable: false,
    manageable: false,
  })
  expect((await send(owner, '/api/billing/checkout', 'POST', { plan: 'week' })).status).toBe(404)
  expect((await send(owner, '/api/billing/portal', 'POST', {})).status).toBe(404)
  const webhook = await fetch(`${origin}/api/billing/dodo/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg_native',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      'webhook-signature': 'v1,AAAA',
    },
    body: JSON.stringify({ type: 'payment.succeeded', data: {} }),
  })
  expect(webhook.status).toBe(404)
  // Signed out, the credits are the session's: none.
  expect((await fetch(`${origin}/api/credits`)).status).toBe(401)

  // The operator's grant: a signed-in person finds nothing there; the operator makes the account a member for life.
  const grant = { operationId: 'native-grant-0001', email: `${billingAccount}@example.invalid` }
  expect((await send(owner, '/api/operator/memberships', 'POST', grant)).status).toBe(404)
  const operator = operatorClient(origin, nativeOperatorToken)
  const granted = await send(operator, '/api/operator/memberships', 'POST', grant)
  expect(granted.status).toBe(200)
  expect(
    (await send(operator, '/api/operator/memberships', 'POST', { ...grant, email: 'nobody@example.invalid' })).status,
  ).toBe(404)
  expect(await (await owner('/api/credits')).json()).toMatchObject({
    daily: memberDailyCredits,
    membership: { plan: 'lifetime', until: null, renews: false },
  })
  await verifyBillingStatements(fixtures)
}

const day = 86_400_000
const iso = (at: number) => new Date(at).toISOString()

/** The membership a step leaves, for Dodo's one customer. */
const member = (plan: string, until: number | null, status: string, subscriptionId: string | null = null) => ({
  plan,
  until: until === null ? null : iso(until),
  status,
  subscriptionId,
  customerId: 'cus_native',
})

/** Every statement of the billing store on workerd's D1 (`BillingFixture.ts`), as a member's payments, refunds and
 * subscription events arrive: a payment counted once, a second week without a customer keeping the first one's, a
 * refund taken back once and never before now, a subscription that runs, is cancelled and ends while an older event
 * changes nothing, the operator's lifetime over it, and a payment for an account gone meanwhile writing nothing. */
const verifyBillingStatements = async (fixtures: string) => {
  const response = await fetch(`${fixtures}/test/billing/statements`, { method: 'POST' })
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  const one = [{ paymentId: 'pay_native_1', status: 'succeeded' }]
  const both = (second: string) => [...one, { paymentId: 'pay_native_2', status: second }]
  const subscribedUntil = billingNow + 40 * day
  expect(body).toEqual({
    steps: [
      { step: 'week', state: { membership: member('week', billingNow + 7 * day, 'active'), purchases: one } },
      { step: 'week again', state: { membership: member('week', billingNow + 7 * day, 'active'), purchases: one } },
      {
        step: 'second week, no customer',
        state: { membership: member('week', billingNow + 14 * day, 'active'), purchases: both('succeeded') },
      },
      {
        step: 'second week refunded',
        state: { membership: member('week', billingNow + 7 * day, 'active'), purchases: both('refunded') },
      },
      {
        step: 'refunded again',
        state: { membership: member('week', billingNow + 7 * day, 'active'), purchases: both('refunded') },
      },
      {
        step: 'subscribed',
        state: { membership: member('monthly', subscribedUntil, 'active', 'sub_native'), purchases: both('refunded') },
      },
      {
        step: 'cancelled',
        state: {
          membership: member('monthly', subscribedUntil, 'cancelled', 'sub_native'),
          purchases: both('refunded'),
        },
      },
      {
        step: 'ended',
        state: { membership: member('monthly', billingNow, 'ended', 'sub_native'), purchases: both('refunded') },
      },
      {
        step: 'older event',
        state: { membership: member('monthly', billingNow, 'ended', 'sub_native'), purchases: both('refunded') },
      },
      {
        step: 'granted',
        state: { membership: member('lifetime', null, 'active', 'sub_native'), purchases: both('refunded') },
      },
    ],
    gone: { failed: true, rows: 0 },
  })
}
