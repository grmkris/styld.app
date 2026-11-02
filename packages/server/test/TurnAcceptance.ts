import { readFileSync } from 'node:fs'
import { expect } from 'bun:test'
import { Schema } from 'effect'
import type { Browser } from 'playwright'
import { recordProblems } from './BrowserAcceptance.ts'
import { Allowance, decoded } from './CleanPictureAcceptance.ts'
import { picturesAccount } from './PictureFixture.ts'
import { client, signedInContext, signIn } from './Accounts.ts'

const Turn = Schema.Struct({ state: Schema.String, version: Schema.Number, layout: Schema.optionalKey(Schema.Unknown) })
const Piece = Schema.Struct({ turn: Schema.optionalKey(Turn) })

/** A piece's clean picture turns on its hanger, made by the queue and finished in the owner's browser: the turn is
 * asked for with its 5 credits held, the video model's job is kept and polled until its video is stored, the piece page
 * cuts the video into frames in Chromium, Clef checks them, and the turn plays on tap with its credits consumed once.
 * The video model and Clef are the fixture's stand-ins; the video is a recorded Veo 3.1 Lite take. It turns the green
 * shirt whose drawing `verifyCleanPictures` offered and the owner took, so it runs in the same test after it. */
export const verifyTurn = async (
  browser: Browser,
  origin: string,
  fixtures: string,
  kept: { readonly green: string; readonly photo: string },
) => {
  const take = readFileSync(new URL('fixtures/capture/veo-turn-black-tee.mp4', import.meta.url))
  expect(
    (await fetch(`${fixtures}/test/pictures/answer?key=video`, { method: 'PUT', body: new Uint8Array(take) })).status,
  ).toBe(204)
  const owner = client(origin, await signIn(origin, picturesAccount))
  const remaining = async () => (await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining
  const before = await remaining()
  // Two requests at once for the piece's first turn: one claims it and holds its credits; the other holds nothing, so
  // it never settles the winner's hold.
  const ask = (operationId: string) =>
    owner(`/api/pieces/${kept.green}/turn`, { method: 'POST', body: JSON.stringify({ operationId }) })
  const raced = await Promise.all([ask('native-turn-0001'), ask('native-turn-0003')])
  expect(raced.map(({ status }) => status).toSorted((one, other) => one - other)).toEqual([200, 409])
  const asked = raced.find(({ status }) => status === 200)
  expect(asked === undefined ? 'none' : (await decoded(Turn, asked)).state).toBe('making')
  expect(await remaining()).toBe(before - 5)
  // A second turn while one is made is refused; the photo-only piece has no clean picture to turn.
  const again = { method: 'POST', body: JSON.stringify({ operationId: 'native-turn-0002' }) }
  expect((await owner(`/api/pieces/${kept.green}/turn`, again)).status).toBe(409)
  expect((await owner(`/api/pieces/${kept.photo}/turn`, again)).status).toBe(409)
  // Muse draws the side view, the video model is asked once while pending and then answers with the take.
  let state = 'making'
  for (let attempt = 0; attempt < 160 && state === 'making'; attempt += 1) {
    await Bun.sleep(250)
    state = (await decoded(Piece, await owner(`/api/pieces/${kept.green}`))).turn?.state ?? 'none'
  }
  expect(state).toBe('building')

  const context = await signedInContext(browser, origin, picturesAccount, { hasTouch: true })
  try {
    const page = await context.newPage()
    const problems = recordProblems(page)
    const consoled: Array<string> = []
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') consoled.push(message.text())
    })
    await page.goto(`${origin}/wardrobe/${kept.green}`, { waitUntil: 'networkidle' })
    // The page cuts the stored video into frames, sends them, and the checked turn replaces the still.
    await page
      .getByText('Tap the picture to turn it.')
      .waitFor({ state: 'visible', timeout: 120000 })
      .catch(async (error: unknown) => {
        const shown = await page.locator('main').innerText()
        throw new Error(`the turn did not get ready: ${String(error)}\n${shown}\n${consoled.join('\n')}`)
      })
    const player = page.getByRole('button', { name: 'Turn it' })
    await player.locator('canvas').waitFor({ state: 'visible' })
    await player.click()
    expect(await player.getAttribute('aria-pressed')).toBe('true')
    expect(problems).toEqual([])
  } finally {
    await context.close()
  }
  const turned = await decoded(Piece, await owner(`/api/pieces/${kept.green}`))
  expect(turned.turn).toMatchObject({ state: 'ready', layout: { frames: 30, columns: 6 } })
  expect((await owner(`/cdn/turns/${kept.green}/sheet?v=${turned.turn?.version}`)).status).toBe(200)
  expect(await remaining()).toBe(before - 5)
}
