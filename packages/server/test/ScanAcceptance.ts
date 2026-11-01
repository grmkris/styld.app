import { expect } from 'bun:test'
import { Schema } from 'effect'
import { decoded } from './CleanPictureAcceptance.ts'
import { scanAccount, scanned } from './ScanFixture.ts'
import { client, signIn } from './Accounts.ts'

const Card = Schema.Struct({
  id: Schema.String,
  preselected: Schema.Boolean,
  sightings: Schema.Number,
  alreadyHave: Schema.optionalKey(Schema.String),
  partial: Schema.Boolean,
})
const Tray = Schema.Struct({
  captures: Schema.Array(Schema.Struct({ id: Schema.String, detections: Schema.Array(Card) })),
})
const Pieces = Schema.Struct({ pieces: Schema.Array(Schema.Struct({ id: Schema.String })) })

/** The tray as cards by detection, and which captures it lists. */
const cardsOf = (tray: typeof Tray.Type) => ({
  cards: new Map(tray.captures.flatMap(({ detections }) => detections.map((card) => [card.id, card]))),
  captures: tray.captures.map(({ id }) => id),
})

/** A garment seen across an import's parts is one card, shown by its fullest sighting, and a garment the wardrobe has
 * asks "Already in your wardrobe?": the match job compares the seeded sightings on the queue, four parts at once,
 * with the Clef stand-in. Keeping a card keeps its other sightings with it, skipping the duplicate adds nothing, and
 * a wrong merge splits apart. */
export const verifyScan = async (origin: string, fixtures: string) => {
  expect((await fetch(`${fixtures}/test/scan/seed`, { method: 'POST' })).status).toBe(204)
  const owner = client(origin, await signIn(origin, scanAccount))
  const tray = async () => cardsOf(await decoded(Tray, await owner('/api/captures/tray')))
  let seen = await tray()
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const done =
      seen.cards.get(scanned.redTwo)?.sightings === 2 &&
      seen.cards.get(scanned.redFour)?.sightings === 2 &&
      seen.cards.get(scanned.greenAgain)?.alreadyHave !== undefined
    if (done) break
    await Bun.sleep(250)
    seen = await tray()
  }
  // One card for each red top, by its fuller sighting; the part whose only whole garment shows elsewhere leaves the
  // list. The green top is the wardrobe's, offered unticked; the fragment needs a better look.
  expect(seen.cards.get(scanned.redTwo)).toMatchObject({ sightings: 2, preselected: true })
  expect(seen.cards.has(scanned.redOne)).toBe(false)
  expect(seen.cards.get(scanned.redFour)).toMatchObject({ sightings: 2 })
  expect(seen.cards.has(scanned.redThree)).toBe(false)
  expect(seen.captures).not.toContain(scanned.partThree)
  expect(seen.cards.get(scanned.greenAgain)).toMatchObject({ alreadyHave: scanned.greenPiece, preselected: false })
  expect(seen.cards.get(scanned.fragment)).toMatchObject({ partial: true, preselected: false })

  // The second import's red tops were different pieces after all.
  const split = await owner(`/api/captures/detections/${scanned.redFour}/split`, { method: 'POST' })
  expect(split.status).toBe(204)
  seen = await tray()
  expect(seen.cards.get(scanned.redFour)).toMatchObject({ sightings: 1 })
  expect(seen.cards.get(scanned.redThree)).toMatchObject({ sightings: 1 })
  expect(seen.captures).toContain(scanned.partThree)
  expect((await owner(`/api/captures/detections/${scanned.redFour}/split`, { method: 'POST' })).status).toBe(404)

  // Keep the first import's red top and skip its green one: one new piece, and the red top's other sighting goes
  // with it, so the first part keeps only its fragment.
  const before = (await decoded(Pieces, await owner('/api/pieces'))).pieces.length
  const reviewed = await owner('/api/captures/review', {
    method: 'POST',
    body: JSON.stringify({
      operationId: 'native-scan-review-1',
      keep: [{ detectionId: scanned.redTwo, type: 'tops' }],
      discard: [scanned.greenAgain],
    }),
  })
  expect(reviewed.status).toBe(200)
  expect((await decoded(Pieces, await owner('/api/pieces'))).pieces.length).toBe(before + 1)
  seen = await tray()
  expect(seen.captures).not.toContain(scanned.partTwo)
  expect(seen.cards.has(scanned.redOne)).toBe(false)
  expect([...seen.cards.keys()].filter((id) => [scanned.redOne, scanned.fragment].includes(id))).toEqual([
    scanned.fragment,
  ])
}
