/**
 * Ask a deployed stage for a shop-style clean picture of every piece of one account that has none (owner, 4 November
 * 2026: most of a tester's pieces were kept before pictures were drawn, or came over from v1), run by hand:
 *
 *   STYLD_URL=https://… bun --env-file=.env.preview.local tools/backfill-pictures.ts <email>
 *
 * The request goes to `POST /api/operator/pictures/backfill` as the operator, with the stage's `STYLD_OPERATOR_TOKEN`
 * from its private env file (the value the deploy binds). The Worker queues the pictures at the piece queue's pace,
 * paid by Styld, never the person's credits, and shows the drawings that were proposed before 4 November. Running it
 * again queues nothing twice; one run queues at most an hour of pictures, and says how many remain for the next.
 * Credentials come from the environment only and are never printed; it prints counts, never names or pictures.
 */
import { PictureBackfilled } from '@styld/protocol'
import { Schema } from 'effect'

const [email] = process.argv.slice(2)
if (email === undefined || !email.includes('@'))
  throw new Error('Usage: STYLD_URL=https://… bun --env-file=.env.preview.local tools/backfill-pictures.ts <email>')

const url = process.env['STYLD_URL']
const token = process.env['STYLD_OPERATOR_TOKEN']
if (url === undefined || token === undefined || token.length === 0)
  throw new Error('Set STYLD_URL, and STYLD_OPERATOR_TOKEN through the stage’s private env file')
const origin = new URL(url).origin
const answer = await fetch(`${origin}/api/operator/pictures/backfill`, {
  method: 'POST',
  headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ operationId: `backfill-${crypto.randomUUID()}`, email }),
})
if (!answer.ok)
  throw new Error(
    `The backfill answered ${answer.status}: is STYLD_OPERATOR_TOKEN the stage's operator token, and does the email ` +
      'sign in to an account there?',
  )
const done = Schema.decodeUnknownSync(PictureBackfilled)(await answer.json())
console.log(
  `Queued ${done.queued} pictures, showed ${done.shown} waiting drawings; ${done.remaining} pieces left for another run`,
)
