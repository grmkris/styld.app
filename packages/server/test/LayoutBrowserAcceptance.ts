import { expect } from 'bun:test'
import type { BrowserContext, Page } from 'playwright'

/** The signed-in pages the navigation moves between. */
const tabPaths = ['/', '/wardrobe', '/looks', '/boards', '/ask', '/account'] as const

/** Where the page's title starts, once it is drawn. */
const titleTop = async (page: Page) => {
  const title = page.locator('main h1').first()
  await title.waitFor({ state: 'visible' })
  return (await title.boundingBox())?.y ?? Number.NaN
}

/** Every tab page's title starts at the same height, so moving between them moves nothing at the top. */
export const expectSameTitleTops = async (page: Page, origin: string) => {
  const tops: Array<{ readonly path: string; readonly top: number }> = []
  for (const path of tabPaths) {
    await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' })
    tops.push({ path, top: await titleTop(page) })
  }
  const [first] = tops
  for (const { path, top } of tops)
    expect({ path, top: Math.round(top) }).toEqual({ path, top: Math.round(first?.top ?? 0) })
}

/** Runs in each page: adds up every layout shift, including those right after a tap (which the browser's own score
 * leaves out), and what moved, on the document element where a test can read them. Plain script: it runs in the
 * page, where nothing from this module exists. */
const layoutShiftProbe = `
let total = 0
const moved = []
const named = (node) =>
  node instanceof Element ? node.tagName.toLowerCase() + '.' + (node.getAttribute('class') ?? '').split(' ')[0] : String(node?.nodeName)
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    total += entry.value
    for (const source of entry.sources ?? [])
      moved.push(named(source.node) + ' y ' + Math.round(source.previousRect.y) + '→' + Math.round(source.currentRect.y))
  }
  document.documentElement.dataset.layoutShift = String(total)
  document.documentElement.dataset.layoutShiftSources = moved.join(' | ')
}).observe({ type: 'layout-shift', buffered: true })
`

export const recordLayoutShifts = (context: BrowserContext) => context.addInitScript({ content: layoutShiftProbe })

/** How far the page has moved since it opened, once nothing is waiting any more: `steady`, or what moved. */
const settledShift = async (page: Page) => {
  await page.waitForFunction(() => document.querySelector('[data-skeleton]') === null)
  await page.waitForTimeout(600)
  const { total, moved } = await page.evaluate(() => ({
    total: Number(document.documentElement.dataset['layoutShift'] ?? '0'),
    moved: document.documentElement.dataset['layoutShiftSources'] ?? '',
  }))
  return total < 0.02 ? 'steady' : `${String(total)}: ${moved}`
}

/** Opening each page whole moves nothing on screen: it is drawn in the shape of what is coming. */
export const expectSteadyFullLoads = async (page: Page, origin: string, paths: ReadonlyArray<string>) => {
  for (const path of paths) {
    await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' })
    expect({ path, shift: await settledShift(page) }).toEqual({ path, shift: 'steady' })
  }
}

const shiftSoFar = (page: Page) => page.evaluate(() => Number(document.documentElement.dataset['layoutShift'] ?? '0'))

/** After a tap on a tab: still the same document, nothing moved, at the top, the title focused. */
const arrivedInPlace = async (page: Page, path: string, shiftBefore: number) => {
  await page.waitForURL((url) => url.pathname === path)
  await page.waitForFunction(() => document.querySelector('[data-skeleton]') === null)
  await page.waitForTimeout(400)
  const arrived = await page.evaluate(() => ({
    kept: document.documentElement.dataset['kept'] === 'yes',
    top: window.scrollY,
    focused: document.activeElement?.matches('main h1') ?? false,
  }))
  const moved = (await shiftSoFar(page)) - shiftBefore
  expect({ path, ...arrived, steady: moved < 0.02 }).toEqual({ path, kept: true, top: 0, focused: true, steady: true })
}

const tap = async (page: Page, path: string) => {
  const before = await shiftSoFar(page)
  await page.locator(`a[href="${path}"]`).first().click()
  await arrivedInPlace(page, path, before)
}

/** Moving between tab pages stays in the page: the navigation is never redrawn, a page seen before shows at once,
 * Back and Forward work, quick taps settle on the last one, and other pages still load whole. */
export const expectInstantTabs = async (page: Page, origin: string) => {
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('[data-skeleton]') === null)
  await page.evaluate(() => {
    document.documentElement.dataset['kept'] = 'yes'
  })
  for (const path of ['/explore', '/wardrobe', '/looks', '/ask', '/boards', '/account', '/']) await tap(page, path)
  // A page seen before is drawn from what the app has: no skeleton, even for a moment.
  await page.locator('a[href="/wardrobe"]').first().click()
  await page.waitForURL((url) => url.pathname === '/wardrobe')
  expect(await page.locator('[data-skeleton]').count()).toBe(0)
  await page.goBack()
  await arrivedInPlace(page, '/', await shiftSoFar(page))
  await page.goBack()
  await arrivedInPlace(page, '/account', await shiftSoFar(page))
  await page.goForward()
  await arrivedInPlace(page, '/', await shiftSoFar(page))
  // Quick taps end where the last one pointed.
  await page.locator('a[href="/wardrobe"]').first().click()
  await page.locator('a[href="/ask"]').first().click()
  await page.waitForURL((url) => url.pathname === '/ask')
  expect(await page.evaluate(() => document.documentElement.dataset['kept'])).toBe('yes')
  // A board is not a tab: it loads whole, in a new document.
  await page.locator('a[href="/boards"]').first().click()
  await page.waitForURL((url) => url.pathname === '/boards')
  await page.locator('a[href^="/boards/bd_"]').first().click()
  await page.waitForURL(/\/boards\/bd_/)
  expect(await page.evaluate(() => document.documentElement.dataset['kept'] ?? 'new')).toBe('new')
}

/** Ask in Slovenian finds pieces the way people type, in either language, and its + sheet opens and closes like
 * a sheet: Escape shuts it and focus returns to the +. */
export const expectSlovenianSearch = async (context: BrowserContext, page: Page, origin: string) => {
  await context.addCookies([{ name: 'styld_locale', value: 'sl', url: origin }])
  await page.goto(`${origin}/ask`, { waitUntil: 'networkidle' })
  const field = page.getByRole('searchbox')
  for (const query of ['čevlji', 'cevlji', 'obutev', 'črne, čevlji']) {
    await field.fill(query)
    await page.getByRole('link', { name: 'Derby shoes' }).waitFor({ state: 'visible' })
  }
  await field.fill('modra, čevlji')
  await page.getByText('Nič v tvoji garderobi se ne ujema z »modra, čevlji«.').waitFor({ state: 'visible' })
  await field.press('Enter')
  const add = page.getByRole('button', { name: 'Dodaj', exact: true })
  await add.click()
  await page.getByRole('dialog', { name: 'Dodaj' }).waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  expect(await add.evaluate((button) => button === document.activeElement)).toBe(true)
  await context.addCookies([{ name: 'styld_locale', value: 'en', url: origin }])
}
