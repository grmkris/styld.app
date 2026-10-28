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

/** Run against either the native edge or the isolated deployed preview. */
export const verifyBrowser = async (browser: Browser, origin: string): Promise<void> => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    const errors = recordProblems(page)
    const documentResponse = await page.goto(origin, { waitUntil: 'networkidle' })
    expect(documentResponse?.status()).toBe(200)
    expect(documentResponse?.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(documentResponse?.headers()['x-frame-options']).toBe('DENY')
    expect(await page.locator('h1').textContent()).toBe('A wardrobe shaped by you.')
    // Compiled zyzz styles reach the page: the masthead lays out as a flex row on Atelier paper.
    expect(await page.locator('header').evaluate((element) => getComputedStyle(element).display)).toBe('flex')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toMatch(
      /^oklch\(0\.945 /,
    )
    await page.selectOption('#language', 'sl')
    await page.waitForFunction(() => document.documentElement.lang === 'sl')
    expect(await page.locator('h1').textContent()).toBe('Garderoba po tvojem okusu.')
    expect((await context.cookies()).find((cookie) => cookie.name === 'styld_locale')).toMatchObject({
      value: 'sl',
      httpOnly: true,
      sameSite: 'Lax',
    })
    await page.reload({ waitUntil: 'networkidle' })
    expect(await page.locator('html').getAttribute('lang')).toBe('sl')
    await page.selectOption('#language', 'ar-XB')
    await page.waitForFunction(() => document.documentElement.dir === 'rtl')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.selectOption('#language', 'en')
    await page.waitForFunction(() => document.documentElement.lang === 'en')
    const loginResponse = await page.goto(new URL('/login', origin).toString(), { waitUntil: 'networkidle' })
    expect(loginResponse?.status()).toBe(200)
    await page.locator('#auth-password').waitFor({ state: 'visible' })
    expect(await page.locator('h1').textContent()).toBe('Sign in to Styld')
    expect(await page.locator('#auth-password').getAttribute('autocomplete')).toBe('current-password')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}
