/**
 * Grant a lifetime membership to the account an email signs in to (owner, 4 November 2026: the owner, testers, the
 * house accounts and v1's hand-granted members), run by hand:
 *
 *   STYLD_URL=https://… bun --env-file=.env.preview.local tools/grant-membership.ts <email>
 *
 * The request goes to `POST /api/operator/memberships` as the operator, with the stage's `STYLD_OPERATOR_TOKEN` from
 * its private env file (the value the deploy binds). Granting again changes nothing. The emails are the operator's to
 * keep, never the repository's. Credentials come from the environment only and are never printed; it prints the
 * account id, never the email.
 */
import { MembershipGranted } from '@styld/protocol'
import { Schema } from 'effect'

const usage = 'Usage: STYLD_URL=https://… bun --env-file=.env.preview.local tools/grant-membership.ts <email>'

const [email, ...more] = process.argv.slice(2)
if (email === undefined || !email.includes('@') || more.length > 0) throw new Error(usage)
const url = process.env['STYLD_URL']
const token = process.env['STYLD_OPERATOR_TOKEN']
if (url === undefined || token === undefined || token.length === 0)
  throw new Error('Set STYLD_URL, and STYLD_OPERATOR_TOKEN through the stage’s private env file')
const origin = new URL(url).origin

const answer = await fetch(`${origin}/api/operator/memberships`, {
  method: 'POST',
  headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ operationId: `grant-${crypto.randomUUID()}`, email }),
})
if (!answer.ok)
  throw new Error(
    `The grant answered ${answer.status}: is STYLD_OPERATOR_TOKEN the stage's operator token, and does the email ` +
      'sign in to an account there?',
  )
const { accountId } = Schema.decodeUnknownSync(MembershipGranted)(await answer.json())
console.log(`Lifetime membership granted to ${accountId}`)
