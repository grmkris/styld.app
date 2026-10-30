import { expect } from 'bun:test'
import type { Page } from 'playwright'

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
