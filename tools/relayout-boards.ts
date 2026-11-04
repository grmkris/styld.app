/**
 * Lay out every "One piece, many outfits" board of these accounts again, each in its own layout with its outfits
 * centred in their places (Eva's report of 4 November 2026: holes in the table; owner: lay out the boards already
 * made), run by hand:
 *
 *   STYLD_URL=https://… bun --env-file=.env.preview.local tools/relayout-boards.ts <email> [<email> …]
 *
 * Each email goes to `POST /api/operator/boards/relayout` as the operator, with the stage's `STYLD_OPERATOR_TOKEN`
 * from its private env file. Outfits, kept looks and pins stay; pieces a person added by hand stay where they are, and
 * outfit pieces moved by hand go back to their places. Each board is laid out once, so running it again lays out
 * nothing twice. Credentials come from the environment only and are never printed; it prints counts, never emails.
 */
import { BoardsRelaid } from '@styld/protocol'
import { Schema } from 'effect'

const usage =
  'Usage: STYLD_URL=https://… bun --env-file=.env.preview.local tools/relayout-boards.ts <email> [<email> …]'
const emails = process.argv.slice(2)
if (emails.length === 0 || emails.some((email) => !email.includes('@'))) throw new Error(usage)
const url = process.env['STYLD_URL']
const token = process.env['STYLD_OPERATOR_TOKEN']
if (url === undefined || token === undefined || token.length === 0)
  throw new Error('Set STYLD_URL, and STYLD_OPERATOR_TOKEN through the stage’s private env file')
const origin = new URL(url).origin

for (const [index, email] of emails.entries()) {
  const answer = await fetch(`${origin}/api/operator/boards/relayout`, {
    method: 'POST',
    headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operationId: `relayout-${crypto.randomUUID()}`, email }),
  })
  if (!answer.ok) {
    console.log(`Account ${index + 1}: the relayout answered ${answer.status}`)
    continue
  }
  const done = Schema.decodeUnknownSync(BoardsRelaid)(await answer.json())
  console.log(
    `Account ${index + 1}: ${done.relaid} of ${done.boards} outfit boards laid out again, ${done.skipped} skipped`,
  )
}
