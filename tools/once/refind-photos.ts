/**
 * Find an account's Gallery photos again with the detector as it is now, at Styld's cost (Eva, 4 November: her photos
 * were found before the detector looked for the person nearest the camera). What the person confirmed, sent to the
 * review tray or added by hand stays; only Styld's own guesses are replaced. docs/archive/PLAN-gallery-delete-2026-11-04.md › G4.
 *
 *   STYLD_URL=https://… bun --env-file=.env.preview.local tools/once/refind-photos.ts <email> [--counts] [--minutes N]
 *
 * Prints the account's photo counts, starts one re-find round as the operator (the stage's `STYLD_OPERATOR_TOKEN`
 * from its private env file), then the counts every 15 seconds for N minutes (5 by default) while the piece queue
 * works. `--counts` only prints the counts. Each run is a new round: run it once. Prints counts, never the email,
 * names or pictures; the token is sent only as the Authorization header.
 */
import { PhotoCounts } from '@styld/protocol'
import { Schema } from 'effect'
import { operatorStage } from '../OperatorStage.ts'

const [email, ...flags] = process.argv.slice(2)
if (email === undefined || email.startsWith('--'))
  throw new Error('Usage: bun tools/once/refind-photos.ts <email> [--counts] [--minutes N]')

const { origin, operatorToken } = operatorStage()
const minutesFlag = flags.indexOf('--minutes')
const minutes = minutesFlag === -1 ? 5 : Number(flags[minutesFlag + 1])
if (!Number.isFinite(minutes) || minutes < 0) throw new Error('--minutes takes a number')

/** A request as the operator, through the public edge. */
const operator = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${origin}/api/operator/photos${path}`, {
    ...init,
    headers: { origin, authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
  })
  if (response.status === 404)
    throw new Error(
      'Not found: is STYLD_OPERATOR_TOKEN the stage’s operator token, and does the email have an account?',
    )
  if (!response.ok) throw new Error(`The stage answered ${response.status}`)
  return Schema.decodeUnknownSync(PhotoCounts)(await response.json())
}

const show = (
  label: string,
  { photos, ready, empty, garments, confirmed, suggested, unmatched, offered }: PhotoCounts,
) =>
  console.log(
    `${label}: ${photos} photos (${ready} ready, ${empty} with nothing found); ${garments} garments: ` +
      `${confirmed} confirmed, ${suggested} suggested, ${unmatched} not in the wardrobe, ${offered} in the tray`,
  )

const counts = () => operator(`?email=${encodeURIComponent(email)}`)

show('Before', await counts())
if (!flags.includes('--counts')) {
  const operationId = `refind-${Date.now().toString(36)}`
  const started = await operator('/refind', { method: 'POST', body: JSON.stringify({ operationId, email }) })
  console.log(`Sent ${started.queued} photos to be found again (round ${operationId}).`)
  for (let elapsed = 0; elapsed < minutes * 60; elapsed += 15) {
    await Bun.sleep(15_000)
    show(`After ${elapsed + 15}s`, await counts())
  }
}
