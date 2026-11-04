import { expect } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { nextTraceExport, recordProblems, recordTelemetry } from './BrowserAcceptance.ts'
import { csrf } from '@styld/auth/config'

/** Where local workerd's `send_email` emulation writes each message's text part. */
const sentMail = join(import.meta.dir, '../../../.alchemy/local/email/text')

const sentFiles = async () => new Set(await readdir(sentMail).catch(() => []))

/** The code in the one message sent since `before`. */
const codeSentSince = async (before: ReadonlySet<string>): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const fresh = [...(await sentFiles())].filter((name) => !before.has(name))
    if (fresh.length > 1) throw new Error(`expected one message, found ${fresh.length}`)
    const [name] = fresh
    if (name !== undefined) {
      const code = /\b(\d{6})\b/.exec(await readFile(join(sentMail, name), 'utf8'))?.[1]
      if (code !== undefined) return code
    }
    await Bun.sleep(100)
  }
  throw new Error('no sign-in code was sent')
}

/** A six-digit code that is not `code`. */
const otherCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

const signOut = (page: Page) => page.getByRole('button', { name: 'Sign out', exact: true })

/** Ask for a code on the sign-in page and return it from the sent mail. */
const requestCode = async (page: Page, email: string) => {
  const before = await sentFiles()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('heading', { name: 'Check your email' }).waitFor({ state: 'visible' })
  return codeSentSince(before)
}

const enterCode = async (page: Page, code: string) => {
  await page.getByLabel('Enter verification code').fill(code)
  await page.getByRole('button', { name: 'Verify code' }).click()
}

/** A new email creates its account with one code, and the same email signs in again later. */
export const verifyBrowserIdentity = async (browser: Browser, origin: string): Promise<void> => {
  const email = `native-${crypto.randomUUID().slice(0, 8)}@styld.test`
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  // A visitor who already allowed diagnostics, so the credential checks below see real exports.
  await context.addCookies([{ name: 'styld_diagnostics', value: 'granted', url: origin }])
  const codes: string[] = []
  try {
    const page = await context.newPage()
    const errors = recordProblems(page)
    const telemetry = recordTelemetry(page)
    await page.goto(new URL('/login', origin).toString(), { waitUntil: 'networkidle' })
    const code = await requestCode(page, email)
    codes.push(code)
    await enterCode(page, otherCode(code))
    await page.getByRole('alert').getByText("That code isn't right.").waitFor({ state: 'visible' })
    expect(await page.getByLabel('Enter verification code').inputValue()).toBe('')
    await enterCode(page, code)
    // A new account lands on Home, where What's new waits and Show me is asked once (owner, 4 November 2026).
    await page.waitForURL(new URL('/', origin).toString())
    await page.getByRole('heading', { name: 'What should we show you first?' }).waitFor({ state: 'visible' })
    await page.goto(new URL('/account', origin).toString(), { waitUntil: 'networkidle' })
    await signOut(page).waitFor({ state: 'visible' })
    // The new account is named after the email until the person names it.
    expect(await page.getByRole('main').textContent()).toContain(email)
    expect(await page.getByRole('main').textContent()).toContain(email.slice(0, email.indexOf('@')))
    expect((await context.cookies()).some((cookie) => cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true)
    await page.reload({ waitUntil: 'networkidle' })
    await signOut(page).waitFor({ state: 'visible' })
    const cookies = await context.cookies()
    await signOut(page).click()
    await page.waitForURL(new URL('/login', origin).toString())
    // Replaying the old browser cookie must fail immediately, without waiting for expiry.
    const replay = await context.request.post(new URL('/api/auth/getSession', origin).toString(), {
      headers: {
        origin: new URL(origin).origin,
        [csrf.header]: csrf.value,
        cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; '),
      },
      data: {},
    })
    expect(await replay.json()).toMatchObject({ _tag: 'Success', value: null })

    // The same email signs in to the same account; the first code is spent.
    const again = await requestCode(page, email)
    codes.push(again)
    await enterCode(page, code)
    await page.getByRole('alert').waitFor({ state: 'visible' })
    await enterCode(page, again)
    await page.waitForURL(new URL('/', origin).toString())
    await page.goto(new URL('/account', origin).toString(), { waitUntil: 'networkidle' })
    await signOut(page).waitFor({ state: 'visible' })
    expect(await page.getByRole('main').textContent()).toContain(email)

    const exported = nextTraceExport(page)
    await page.reload({ waitUntil: 'networkidle' })
    expect(await exported).toBe(204)
    // Telemetry carries Message tags and timings, never the email or the codes typed on the page.
    expect(telemetry.length).toBeGreaterThan(0)
    for (const secret of [email, ...codes]) expect(telemetry.join('\n')).not.toContain(secret)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}
