import { expect } from 'bun:test'
import { Schema } from 'effect'
import type { Browser } from 'playwright'
import { recordProblems } from './BrowserAcceptance.ts'
import { client, signIn } from './WardrobeAcceptance.ts'

const Identified = Schema.Struct({ id: Schema.String })

/** A signed-out visitor at a published profile: its public board in its list, then the board itself, read only,
 * with whose it is; a private board's address reads as not there. No CSP violations on the way. */
export const verifyPublicJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-social-browser`, { method: 'POST' })).status).toBe(204)
  const owner = client(origin, await signIn(origin, 'native-social-browser'))
  const send = (path: string, method: string, body: unknown) => owner(path, { method, body: JSON.stringify(body) })
  await send('/api/profile', 'PATCH', { handle: 'luka.horvat', name: 'Luka Horvat', city: 'Ljubljana' })
  expect((await send('/api/profile/published', 'PUT', { published: true })).status).toBe(200)
  const created = async (operationId: string, name: string) =>
    Schema.decodeUnknownSync(Identified)(await (await send('/api/boards', 'POST', { operationId, name })).json()).id
  const rain = await created('native-social-browser-1', 'Rain')
  const hidden = await created('native-social-browser-2', 'Gifts')
  expect((await send(`/api/boards/${rain}/visibility`, 'PUT', { visibility: 'public' })).status).toBe(200)

  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const page = await visitor.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/@luka.horvat`)
    await page.getByRole('heading', { name: 'Luka Horvat' }).waitFor()
    await page.getByText('@luka.horvat · Ljubljana').waitFor()
    expect(await page.getByRole('link', { name: /Gifts/ }).count()).toBe(0)
    await page.getByRole('link', { name: /Rain/ }).click()
    await page.getByRole('heading', { name: 'Rain' }).waitFor()
    expect(new URL(page.url()).pathname).toBe(`/boards/${rain}`)
    await page.getByRole('link', { name: /Luka Horvat/ }).waitFor()
    expect(await page.getByRole('button', { name: 'Board settings' }).count()).toBe(0)
    await page.goto(`${origin}/boards/${hidden}`)
    await page.getByText('This board isn’t here any more.').waitFor()
    expect(await page.getByRole('heading', { name: 'Gifts' }).count()).toBe(0)
    expect(problems).toEqual([])
  } finally {
    await visitor.close()
  }
}
