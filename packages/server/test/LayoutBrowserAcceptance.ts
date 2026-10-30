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
