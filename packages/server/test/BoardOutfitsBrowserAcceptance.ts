import { expect } from 'bun:test'
import type { Browser } from 'playwright'
import { recordProblems } from './BrowserAcceptance.ts'
import { client, seedAccounts, signedInContext, signIn } from './Accounts.ts'
import { addPiece, shoot } from './GalleryBrowserAcceptance.ts'

/** Test-only acceptance: "One piece, many outfits" in the browser (T-10, T-16). + on Boards opens the new-board sheet;
 * the template asks for a piece and makes the board on sand paper, the piece large in the middle and every outfit in
 * shoes; its outfits are cards under the table; Another layout lays them out again; Keep makes a look, which opens;
 * Another says when the wardrobe has no other outfit. */

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
    await sheet.getByRole('button', { name: /^One piece, many outfits/ }).click()
    await page.getByText('Pick the piece to build outfits around.').waitFor({ state: 'visible' })
    const shorts = page.getByRole('button', { name: /^Denim shorts/ })
    expect(
      await shorts
        .locator('img')
        .evaluate((image) => image instanceof HTMLImageElement && image.decode().then(() => true)),
    ).toBe(true)
    await shorts.click()
    await shoot(page, 'phone-board-anchor')
    await page.getByRole('button', { name: 'Make the outfits' }).click()

    // The board opens around the shorts on sand: each outfit a card under the table, fewer than its layout holds said.
    await page.waitForURL(/\/boards\/bd_[^/]+$/)
    await page.getByRole('heading', { name: 'Denim shorts: outfits', level: 1 }).waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Outfits', exact: true }).waitFor({ state: 'visible' })
    const cards = page.getByRole('img', { name: /^Outfit \d$/ })
    expect(await cards.count()).toBeGreaterThanOrEqual(2)
    await page.getByText(/^Your wardrobe made \d outfits around this piece\./).waitFor({ state: 'visible' })
    expect(await page.locator('section[data-paper]').getAttribute('data-paper')).toBe('sand')
    // The shorts large in the middle and once in each outfit, every outfit in the derbies.
    // Counted on the table: the board's title, named after the shorts, is a button too (it renames the board).
    const table = page.getByRole('region', { name: 'The table' })
    const shortsItems = table.getByRole('button', { name: /^Denim shorts/ })
    expect(await shortsItems.count()).toBe((await cards.count()) + 1)
    expect(await table.getByRole('button', { name: /^Derby shoes/ }).count()).toBe(await cards.count())
    await shoot(page, 'phone-outfit-board')

    // Another layout lays the board out again; arrows lead from the shorts to each outfit whenever the layout has them.
    const arrowsBefore = await page.locator('[data-arrows] path').count()
    const relaid = page.waitForResponse((response) => response.url().endsWith('/layout') && response.ok())
    await page.getByRole('button', { name: 'Another layout' }).click()
    await relaid
    await page.getByRole('button', { name: 'Another layout' }).waitFor({ state: 'visible' })
    const arrowsAfter = await page.locator('[data-arrows] path').count()
    for (const arrows of [arrowsBefore, arrowsAfter]) expect([0, await cards.count()]).toContain(arrows)
    await shoot(page, 'phone-outfit-board-relaid')

    // Another answers either way: a new outfit in that place, or, when every combination has been shown, says so.
    // Which one depends on the layout dealt above (a smaller one frees outfits), so the words are asserted in the
    // story tests and here only that the answer arrives and the board stays whole.
    const another = page.waitForResponse((response) => /\/outfits\/[^/]+\/another$/u.test(response.url()))
    await page.getByRole('button', { name: 'Another', exact: true }).first().click()
    expect([200, 422]).toContain((await another).status())
    expect(await shortsItems.count()).toBe((await cards.count()) + 1)

    // Keep makes the first outfit a look pinned on the board; it opens from its card.
    await page.getByRole('button', { name: 'Keep' }).first().click()
    await page.getByText('Kept as a look').first().waitFor({ state: 'visible' })
    await shoot(page, 'phone-outfit-kept')
    await page.getByRole('link', { name: 'Open the look' }).first().click()
    await page.getByRole('heading', { name: 'Denim shorts: outfits · 1' }).waitFor({ state: 'visible' })
    expect(problems).toEqual([])
  } finally {
    await phone.close()
  }
}
