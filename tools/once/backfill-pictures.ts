/**
 * Ask a deployed stage for a shop-style clean picture of every piece of one account that has none (owner, 4 November
 * 2026: most of a tester's pieces were kept before pictures were drawn, or came over from v1), run by hand:
 *
 *   STYLD_URL=https://… bun --env-file=.env.preview.local tools/once/backfill-pictures.ts <email> \
 *     [--redraw | --ended | --backs] [--before <ISO moment>]
 *
 * The request goes to `POST /api/operator/pictures/backfill` as the operator, with the stage's `STYLD_OPERATOR_TOKEN`
 * from its private env file (the value the deploy binds). The Worker queues the pictures at the piece queue's pace,
 * paid by Styld, never the person's credits, and shows the drawings that were proposed before 4 November. Running it
 * again queues nothing twice; one run queues at most an hour of pictures, and says how many remain for the next.
 *
 * With `--redraw`, after the prompt changed (4 November: the pressed prompt), every drawing of the account that ended
 * before the moment is drawn again: a minute's worth a request, since a piece waiting for its new drawing shows its
 * cut-out, and the script asks again each minute until none remain. With `--ended` (4 November: the fixed prompt and
 * the refusal fallback) only the drawings that ended dropped or failed before the moment are drawn again, at the same
 * pace, and every shown drawing is left alone. The moment is `--before` (an ISO date and time), or when the script
 * started: started again after a dropped connection, give it the moment the first run printed, so the set never
 * widens to drawings made meanwhile. A request that fails on the way, or that the stage answers with a 5xx, is asked
 * again a minute later; an answer that refuses the token or the email stops the script.
 * With `--backs` (4 November: a pressed back, drawn only from a back the person photographed), every piece of the
 * account with a back that has no drawing of it yet is asked of the back picture job, at the same pace.
 * Credentials come from the environment only and are never printed; it prints counts, never names or pictures.
 */
import { PictureBackfilled } from '@styld/protocol'
import { parseArgs } from 'node:util'
import { Schema } from 'effect'

const usage =
  'Usage: STYLD_URL=https://… bun --env-file=.env.preview.local tools/once/backfill-pictures.ts <email> ' +
  '[--redraw | --ended | --backs] [--before <ISO moment>]'
/** The moment `--before` names, or now; it throws the usage line for one that is not a date. */
const momentOf = (before: string | undefined) => {
  const moment = before === undefined ? Date.now() : Date.parse(before)
  if (Number.isNaN(moment)) throw new Error(`--before takes an ISO moment. ${usage}`)
  return moment
}

/** The email, the mode and the moment the command line names; it throws the usage line for anything else. */
const parsed = (words: Array<string>) => {
  const { values, positionals } = parseArgs({
    args: words,
    allowPositionals: true,
    options: {
      redraw: { type: 'boolean' },
      ended: { type: 'boolean' },
      backs: { type: 'boolean' },
      before: { type: 'string' },
    },
  })
  const [email, ...more] = positionals
  const chosen = [values.redraw, values.ended, values.backs].filter(Boolean).length
  if (email === undefined || !email.includes('@') || more.length > 0 || chosen > 1) throw new Error(usage)
  const redraws = values.redraw === true || values.ended === true
  if (values.before !== undefined && !redraws) throw new Error(`--before goes with --redraw or --ended. ${usage}`)
  return {
    email,
    mode: values.ended === true ? 'ended' : values.backs === true ? 'backs' : 'pictures',
    redrawBefore: redraws ? momentOf(values.before) : undefined,
  }
}

const { email, mode, redrawBefore } = parsed(process.argv.slice(2))
const url = process.env['STYLD_URL']
const token = process.env['STYLD_OPERATOR_TOKEN']
if (url === undefined || token === undefined || token.length === 0)
  throw new Error('Set STYLD_URL, and STYLD_OPERATOR_TOKEN through the stage’s private env file')
const origin = new URL(url).origin
if (redrawBefore !== undefined)
  console.log(`Drawing again what ended before ${new Date(redrawBefore).toISOString()} (pass it as --before to resume)`)

const minute = 60_000

/** One request; none when it failed on the way or the stage answered 5xx, so the caller asks again. */
const once = async () => {
  const answer = await fetch(`${origin}/api/operator/pictures/backfill`, {
    method: 'POST',
    headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      operationId: `backfill-${crypto.randomUUID()}`,
      email,
      redrawBefore,
      ...(mode === 'ended' ? { ended: true } : {}),
      ...(mode === 'backs' ? { backs: true } : {}),
    }),
  }).catch((error: unknown) => {
    console.log(`The request failed on the way (${error instanceof Error ? error.name : 'error'}); asking again`)
    return undefined
  })
  if (answer === undefined) return undefined
  if (answer.status >= 500) {
    console.log(`The backfill answered ${answer.status}; asking again in a minute`)
    return undefined
  }
  if (!answer.ok)
    throw new Error(
      `The backfill answered ${answer.status}: is STYLD_OPERATOR_TOKEN the stage's operator token, and does the ` +
        'email sign in to an account there?',
    )
  return Schema.decodeUnknownSync(PictureBackfilled)(await answer.json())
}

/** Ask until the stage answers, a minute between tries. */
const run = async (): Promise<PictureBackfilled> => {
  for (;;) {
    const done = await once()
    if (done !== undefined) return done
    await Bun.sleep(minute)
  }
}

for (;;) {
  const done = await run()
  console.log(
    `${redrawBefore === undefined ? 'Queued' : 'Queued again'} ${done.queued} pictures, showed ${done.shown} waiting ` +
      `drawings; ${done.remaining} pieces left for another run`,
  )
  if (redrawBefore === undefined || done.remaining === 0) break
  await Bun.sleep(minute)
}
