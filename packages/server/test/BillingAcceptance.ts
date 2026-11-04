import { expect } from 'bun:test'
import { client, seedAccounts, signIn } from './Accounts.ts'

/** The account the billing journey reads its credits as. */
const billingAccount = 'native-billing'

/** A stage without Dodo's key and webhook secret (the native stack has neither) sells nothing, through the real edge:
 * `GET /api/credits` answers the free allowance with premium unavailable, the checkout is not there, and the webhook
 * answers 404 to anything, so a delivery to a stage that cannot verify it never counts. A stage with payments is read
 * back on the deployed preview with Dodo's test mode (docs/DEPLOYMENT.md). */
export const verifyBillingOff = async (origin: string, fixtures: string) => {
  await seedAccounts(fixtures, billingAccount)
  const owner = client(origin, await signIn(origin, billingAccount))
  const credits = await owner('/api/credits')
  expect(credits.status).toBe(200)
  expect(await credits.json()).toEqual({ remaining: 100, daily: 100, premiumUntil: null, premiumAvailable: false })
  expect((await owner('/api/billing/checkout', { method: 'POST' })).status).toBe(404)
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
}
