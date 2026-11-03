import { expect } from 'bun:test'
import type { Browser, Page } from 'playwright'
import { signedInContext } from './Accounts.ts'
import { navigationAccount, navigationBoard, navigationPhoto, navigationPiece } from './NavigationFixture.ts'

const shots = process.env['STYLD_NAVIGATION_SHOTS']
const pieceShots = process.env['STYLD_T15_SHOTS']
const shoot = async (page: Page, name: string, width: number) => {
  if (shots !== undefined) await page.screenshot({ path: `${shots}/T-06-${name}-after-${width}.png` })
}
const shootPiece = async (page: Page, name: string, width: number) => {
  if (pieceShots !== undefined)
    await page.screenshot({ path: `${pieceShots}/T-15-piece-rotation-${name}-${width}.png` })
}

const returnedToPiece = async (page: Page) => {
  await page.waitForFunction(() => location.search.includes('group=shoes') && location.search.includes('type=flats'))
  await page.waitForFunction((id) => {
    const item = document.getElementById(`piece-${id}`)
    if (item === null) return false
    const bounds = item.getBoundingClientRect()
    // Browser scroll offsets round to CSS pixels while grid tracks retain subpixel positions.
    return bounds.top >= -1 && bounds.bottom <= innerHeight + 1
  }, navigationPiece)
  expect(await page.getByRole('link', { name: /Navigation dress/ }).count()).toBe(0)
}

/** Filters, visible returns and system Back survive real document loads, not just an in-memory page update. */
export const verifyNavigationJourney = async (browser: Browser, origin: string, fixtures: string) => {
  expect((await fetch(`${fixtures}/test/identity/navigation`, { method: 'POST' })).status).toBe(204)
  for (const width of [390, 1440]) {
    const context = await signedInContext(browser, origin, navigationAccount, { viewport: { width, height: 844 } })
    const page = await context.newPage()
    const errors: Array<string> = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${origin}/wardrobe`, { waitUntil: 'networkidle' })
    const historyLength = await page.evaluate(() => history.length)
    // The groups, then a group's types, then a type's pieces: each step down is a page of its own (T-07).
    await page.getByRole('link', { name: 'Shoes', exact: true }).click()
    await page.waitForFunction(() => location.search.includes('group=shoes'))
    await page.getByRole('link', { name: 'Flats', exact: true }).click()
    await page.waitForFunction(() => location.search.includes('type=flats'))
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 2)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Flats', level: 2 }).waitFor()
    await page.getByRole('link', { name: 'Navigation flats 20', exact: true }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
    await page.getByRole('link', { name: 'Back to wardrobe', exact: true }).click()
    await returnedToPiece(page)
    await page.evaluate(() => document.fonts.ready)
    await shoot(page, 'wardrobe-return', width)
    await page.getByRole('link', { name: 'Navigation flats 20', exact: true }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
    await shootPiece(page, 'before', width)
    // Rotation is part of editing the piece (T-15): Edit previews a quarter turn and Save keeps it.
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('button', { name: 'Rotate image 90°', exact: true }).click()
    await shootPiece(page, 'after', width)
    await page.goBack({ waitUntil: 'networkidle' })
    await returnedToPiece(page)

    await page.goto(`${origin}/gallery/${navigationPhoto}`, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: 'Open the review tray', exact: true }).click()
    await page.getByRole('heading', { name: 'To review', exact: true }).waitFor()
    await page.getByRole('link', { name: 'Back', exact: true }).click()
    await page.waitForURL(`**/gallery/${navigationPhoto}`)
    await page.getByRole('link', { name: 'Open the review tray', exact: true }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    await shoot(page, 'gallery-return', width)

    await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: /Navigation board/ }).waitFor()
    await page.goto(`${origin}/boards/${navigationBoard}/collage`, { waitUntil: 'networkidle' })
    await page.waitForURL(`**/boards/${navigationBoard}`)
    const boardHistory = await page.evaluate(() => history.length)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    expect(await page.evaluate(() => history.length)).toBe(boardHistory)
    await page.goBack({ waitUntil: 'networkidle' })
    expect(new URL(page.url()).pathname).toBe('/boards')
    expect(errors).toEqual([])
    await context.close()
  }
}
