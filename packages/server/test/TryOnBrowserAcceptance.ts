import { expect } from 'bun:test'
import type { Browser, Page } from 'playwright'
import { client, seedAccounts, send, signedInContext, signIn } from './Accounts.ts'
import { recordProblems } from './BrowserAcceptance.ts'
import { museTee } from './CleanPictureAcceptance.ts'
import { addedPiece, idOf } from './GalleryAcceptance.ts'
import { receivedPhoto, waitUntilReady } from './WardrobeAcceptance.ts'

/** Test-only acceptance: Try on in the Lab on a phone (owner, 4 November 2026). A Gallery photo and a piece are
 * chosen, the person says the photo shows them, the cost is read before Try on, the try-on opens at its own address
 * and its drawing comes back beside its photo (Before or After), and Delete takes it away after asking once and goes
 * back to the list. Muse is the fixture Worker's stand-in. */

const accountId = 'native-try-on-browser'

/** The new try-on's choice: the Gallery's photo, the first piece, This is me, after reading the cost. */
const choose = async (page: Page) => {
  await page.getByRole('button', { name: 'New try-on' }).click()
  await page
    .getByRole('button', { name: /^Photo from / })
    .first()
    .click()
  await page
    .locator('section', { has: page.getByRole('heading', { name: 'What to wear' }) })
    .locator('li button')
    .first()
    .click()
  await page.getByText('Chosen: 1 of 9').waitFor({ state: 'visible' })
  await page.getByText('2 credits.').waitFor({ state: 'visible' })
  const tryOn = page.getByRole('button', { name: 'Try on', exact: true })
  expect(await tryOn.getAttribute('aria-disabled')).toBe('true')
  await page.getByRole('checkbox', { name: 'This is me' }).check()
  expect(await tryOn.getAttribute('aria-disabled')).not.toBe('true')
  await tryOn.click()
  await page.waitForURL(/\/try-on\/to_[A-Za-z0-9_-]{22}$/u)
}

/** The drawing beside its photo: After first on a phone, Before one tap away; then Delete, asked once more. */
const compareAndDelete = async (page: Page) => {
  const after = page.getByRole('img', { name: 'You in the chosen pieces' })
  const before = page.getByRole('img', { name: 'Your photo' })
  await after.waitFor({ state: 'visible', timeout: 30_000 })
  await before.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Before' }).click()
  await before.waitFor({ state: 'visible' })
  await after.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Save to board' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Delete try-on' }).click()
  const question = page.getByRole('alertdialog', { name: 'Delete try-on' })
  await question.getByText('Delete this try-on? Your photo stays in your Gallery.').waitFor({ state: 'visible' })
  await question.getByRole('button', { name: 'Delete try-on' }).click()
  await page.waitForURL(/\/try-on$/u)
  await page.getByRole('heading', { name: 'See yourself in your clothes' }).waitFor({ state: 'visible' })
}

export const verifyTryOnJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, accountId)
  const call = client(origin, await signIn(origin, accountId))
  expect((await fetch(`${fixtures}/test/pictures/answer?key=green`, { method: 'PUT', body: museTee() })).status).toBe(
    204,
  )
  await idOf(
    await send(call, '/api/photos', 'POST', {
      operationId: 'native-try-on-browser-photo',
      uploadId: await receivedPhoto(origin, call),
    }),
  )
  const pieceId = await addedPiece(origin, call, 'native-try-on-browser-piece')
  expect(await waitUntilReady(call, pieceId)).toBe('ready')

  const phone = await signedInContext(browser, origin, accountId, { viewport: { width: 390, height: 844 } })
  try {
    const page = await phone.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/try-on`)
    await page.getByRole('heading', { name: 'See yourself in your clothes' }).waitFor({ state: 'visible' })
    await choose(page)
    await compareAndDelete(page)
    expect(problems).toEqual([])
  } finally {
    await phone.close()
  }
}
