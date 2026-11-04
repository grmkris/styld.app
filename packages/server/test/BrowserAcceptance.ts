import { expect } from 'bun:test'
import type { Browser, Page } from 'playwright'

/** Collects page errors and Content Security Policy violations reported by the browser. */
export const recordProblems = (page: Page): string[] => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) problems.push(message.text())
  })
  return problems
}

const tracesPath = '/api/telemetry/v1/traces'

/** Every browser telemetry body the page sends, so tests can assert what leaves it. */
export const recordTelemetry = (page: Page): string[] => {
  const bodies: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/telemetry/')) bodies.push(request.postData() ?? '')
  })
  return bodies
}

/** Resolves with the relay's status for the next trace export, e.g. the flush on leaving a page. */
export const nextTraceExport = (page: Page): Promise<number> =>
  page
    .waitForResponse((response) => new URL(response.url()).pathname === tracesPath, { timeout: 20000 })
    .then((response) => response.status())

/** Run against either the native edge or the isolated deployed preview. */
export const verifyBrowser = async (browser: Browser, origin: string): Promise<void> => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    const errors = recordProblems(page)
    const telemetry = recordTelemetry(page)
    const documentResponse = await page.goto(origin, { waitUntil: 'networkidle' })
    expect(documentResponse?.status()).toBe(200)
    expect(documentResponse?.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(documentResponse?.headers()['x-frame-options']).toBe('DENY')
    // Nothing leaves the page before the visitor answers the diagnostics prompt, even on exit. The prompt asks only a
    // signed-in person on its own; a visitor opens it from the footer's Diagnostics.
    const prompt = page.getByRole('region', { name: 'Diagnostics' })
    expect(await prompt.count()).toBe(0)
    await page.reload({ waitUntil: 'networkidle' })
    // Longer than the SDK's 5 s auto-flush: without the consent gate it would have posted by now.
    await page.waitForTimeout(6000)
    expect(telemetry).toEqual([])
    await page.getByRole('contentinfo').getByRole('button', { name: 'Diagnostics', exact: true }).click()
    await prompt.waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Allow', exact: true }).click()
    await prompt.waitFor({ state: 'hidden' })
    expect((await context.cookies()).find((cookie) => cookie.name === 'styld_diagnostics')?.value).toBe('granted')
    // The telemetry SDK downloads only for a visitor who allowed it, so diagnostics start with the next page load.
    await page.reload({ waitUntil: 'networkidle' })
    expect(await page.locator('h1').textContent()).toBe('Every outfit starts in your wardrobe.')
    // Compiled zyzz styles reach the page: the masthead lays out as a flex row on Gallery paper (#f1eee7),
    // and the self-hosted font is in use.
    expect(await page.locator('header').evaluate((element) => getComputedStyle(element).display)).toBe('flex')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(
      'rgb(241, 238, 231)',
    )
    expect(await page.evaluate(() => document.fonts.check('600 16px "Hanken Grotesk Variable"'))).toBe(true)
    await page.selectOption('#language', 'sl')
    await page.waitForFunction(() => document.documentElement.lang === 'sl')
    expect(await page.locator('h1').textContent()).toBe('Vsak videz se začne v tvoji garderobi.')
    expect((await context.cookies()).find((cookie) => cookie.name === 'styld_locale')).toMatchObject({
      value: 'sl',
      httpOnly: true,
      sameSite: 'Lax',
    })
    // Leaving the page flushes the Foldkit Command spans (SaveLocale) to the same-origin relay.
    const exported = nextTraceExport(page)
    await page.reload({ waitUntil: 'networkidle' })
    expect(await exported).toBe(204)
    expect(await page.locator('html').getAttribute('lang')).toBe('sl')
    // The menu offers only the reviewed languages; right-to-left layout is checked by turning the page's direction
    // in code, as the RTL pseudo-locale would.
    expect(
      await page.locator('#language option').evaluateAll((options) => options.map((option) => option.textContent)),
    ).toEqual(['English', 'Slovenščina'])
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl'
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.evaluate(() => {
      document.documentElement.dir = 'ltr'
    })
    await page.selectOption('#language', 'en')
    await page.waitForFunction(() => document.documentElement.lang === 'en')
    const loginResponse = await page.goto(new URL('/login', origin).toString(), { waitUntil: 'networkidle' })
    expect(loginResponse?.status()).toBe(200)
    await page.getByLabel('Email').waitFor({ state: 'visible' })
    expect(await page.locator('h1').textContent()).toBe('Sign in to Styld')
    expect(await page.getByLabel('Email').getAttribute('autocomplete')).toBe('email')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
  await verifyLanding(browser, origin)
}

/** The signed-out Home (owner, 4 November 2026): the wardrobe's film for everyone; under reduced motion no film is asked
 * for; the words and Start free fit the first screen of a small phone in Slovenian, and nothing overflows sideways at a
 * phone's, a tablet's or a desktop's width. */
const verifyLanding = async (browser: Browser, origin: string): Promise<void> => {
  const context = await browser.newContext({
    locale: 'sl-SI',
    viewport: { width: 360, height: 740 },
    reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    const errors = recordProblems(page)
    const films: Array<string> = []
    page.on('request', (request) => {
      if (/\/cdn\/landing\/.*\.mp4$/.test(new URL(request.url()).pathname)) films.push(request.url())
    })
    await page.goto(origin, { waitUntil: 'networkidle' })
    const hero = page.getByRole('region', { name: 'Vsak videz se začne v tvoji garderobi.' })
    // Reduced motion: the poster stays and no film is requested.
    expect(await hero.locator('img').count()).toBe(1)
    expect(await hero.locator('video').count()).toBe(0)
    expect(films).toEqual([])
    const start = page.getByRole('link', { name: 'Začni brezplačno' }).first()
    const box = await start.boundingBox()
    expect(box !== null && box.y + box.height <= 740).toBe(true)
    for (const [width, height] of [
      [360, 740],
      [390, 844],
      [768, 1024],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}
