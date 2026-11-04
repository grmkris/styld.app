import { expect } from 'bun:test'
import type { Browser } from 'playwright'
import { recordProblems } from './BrowserAcceptance.ts'
import { client, seedAccounts, signedInContext, signIn } from './Accounts.ts'
import { addPiece, shoot } from './GalleryBrowserAcceptance.ts'

/** Test-only acceptance: "One piece, six outfits" in the browser (T-10, T-16). + on Boards opens the new-board sheet;
 * the template asks for a piece and makes the board; its outfits are cards under the table; Keep makes a look, which
 * opens; Another says when the wardrobe has no other outfit. */

const account = 'native-outfits-browser'

export const verifyOutfitBoardJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, account)
  const call = client(origin, await signIn(origin, account))
  await addPiece(origin, call, 'knit-cable-navy.webp', { type: 'knitwear', colours: ['navy'], name: 'Cable knit' })
  await addPiece(origin, call, 'shirt-sky.webp', { type: 'shirts', colours: ['blue'], name: 'Oxford shirt' })
  await addPiece(origin, call, 'shorts-denim.webp', { type: 'shorts', colours: ['blue'], name: 'Denim shorts' })
  await addPiece(origin, call, 'derby-black.webp', { type: 'laceUps', colours: ['black'], name: 'Derby shoes' })

  const phone = await signedInContext(browser, origin, account, {
    viewport: { width: 390, height: 844 },
    answered: true,
    hasTouch: true,
  })
  try {
    const page = await phone.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'New board' }).click()
    const sheet = page.getByRole('dialog', { name: 'New board' })
    await sheet.waitFor({ state: 'visible' })
    await shoot(page, 'phone-board-templates')
    await sheet.getByRole('button', { name: /^One piece, six outfits/ }).click()
    await page.getByText('Pick the piece to build outfits around.').waitFor({ state: 'visible' })
    const shorts = page.getByRole('button', { name: /^Denim shorts/ })
    expect(
      await shorts
        .locator('img')
        .evaluate((image) => image instanceof HTMLImageElement && image.decode().then(() => true)),
    ).toBe(true)
    await shorts.click()
    await shoot(page, 'phone-board-anchor')
    await page.getByRole('button', { name: 'Make six outfits' }).click()

    // The board opens around the shorts: each outfit a card under the table, fewer than six said.
    await page.waitForURL(/\/boards\/bd_[^/]+$/)
    await page.getByRole('heading', { name: 'Denim shorts: six outfits', level: 1 }).waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Six outfits', exact: true }).waitFor({ state: 'visible' })
    const cards = page.getByRole('img', { name: /^Outfit \d$/ })
    expect(await cards.count()).toBeGreaterThanOrEqual(2)
    await page.getByText(/^Your wardrobe made \d outfits around this piece\./).waitFor({ state: 'visible' })
    expect(await page.locator('[data-item]').count()).toBeGreaterThanOrEqual(6)
    await shoot(page, 'phone-outfit-board')

    // Another, when every combination has been shown, says so.
    await page.getByRole('button', { name: 'Another' }).first().click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Your wardrobe has no other outfit around this piece.' })
      .waitFor({ state: 'visible' })

    // Keep makes the first outfit a look pinned on the board; it opens from its card.
    await page.getByRole('button', { name: 'Keep' }).first().click()
    await page.getByText('Kept as a look').first().waitFor({ state: 'visible' })
    await shoot(page, 'phone-outfit-kept')
    await page.getByRole('link', { name: 'Open the look' }).first().click()
    await page.getByRole('heading', { name: 'Denim shorts: six outfits · 1' }).waitFor({ state: 'visible' })
    expect(problems).toEqual([])
  } finally {
    await phone.close()
  }
}
