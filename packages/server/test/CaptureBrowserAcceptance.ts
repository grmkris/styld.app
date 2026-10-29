import { expect } from 'bun:test'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { recordProblems } from './BrowserAcceptance.ts'

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/capture/${name}`, import.meta.url))

/** Say what an unnamed found piece is: ticking it opens it, a category keeps it, Done closes it. */
const keepAs = async (page: Page, category: string) => {
  await page.getByRole('button', { name: 'Keep Pick a category' }).first().click()
  await page.getByRole('button', { name: category, exact: true }).click()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: `Keep ${category}` }).waitFor({ state: 'visible' })
}

/** Three photos go up through the picker, wait in the review tray, two are kept with a category and
 * the third is dropped; the wardrobe then shows the two. Providers are off natively, so each photo is
 * one found piece without a suggestion. */
export const verifyCaptureJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-capture-browser`, { method: 'POST' })).status).toBe(204)
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  try {
    const signIn = await context.request.post(`${origin}/api/auth/signIn`, {
      headers: { origin, 'x-effect-auth-csrf': '1' },
      data: { payload: { email: 'native-capture-browser@example.invalid', password: 'native-identity-password-52' } },
    })
    expect(signIn.status()).toBe(200)
    const page = await context.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/wardrobe/add`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Add pieces' }).waitFor({ state: 'visible' })
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles([fixture('red-tee.png'), fixture('blue-dress.png'), fixture('green-shirt.png')])
    await page.waitForURL(`${origin}/wardrobe/review`, { timeout: 30000 })
    await page.getByRole('heading', { name: '3 pieces found' }).waitFor({ state: 'visible', timeout: 30000 })
    expect(await page.getByRole('button', { name: 'Keep Pick a category' }).count()).toBe(3)
    await page.getByText('9 of 12 free today').waitFor({ state: 'visible' })

    await keepAs(page, 'Tops')
    await keepAs(page, 'Dresses')
    const add = page.getByRole('button', { name: 'Add 2 to my wardrobe' })
    await add.click()
    await page.waitForURL(`${origin}/wardrobe`, { timeout: 30000 })
    await page.getByRole('link', { name: 'Tops' }).waitFor({ state: 'visible' })
    await page.getByRole('link', { name: 'Dresses' }).waitFor({ state: 'visible' })
    expect(await page.locator('a[href^="/wardrobe/pc_"]').count()).toBe(2)
    // The dropped piece left the tray with the rest.
    await page.goto(`${origin}/wardrobe/review`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'No scans waiting for review' }).waitFor({ state: 'visible' })
    expect(problems).toEqual([])
  } finally {
    await context.close()
  }
}
