// A signed-in browser session on a deployed stage, for the operator's scripts that act as a person
// (`preview-capture.ts`, `measure/`): the real login page and an email code. The code goes to the account's inbox;
// whoever reads it writes it to the code file and the script continues. The session is kept in a state file
// (mode 600) for later runs. Nothing here prints cookies, codes or addresses.
import { existsSync } from 'node:fs'
import { chmod, readFile, rm } from 'node:fs/promises'
import { type Browser, type BrowserContext } from 'playwright'

export interface Deployed {
  readonly origin: string
  readonly email: string
  /** Where the operator writes the emailed code. */
  readonly codeFile: string
  /** Where the session is kept between runs. */
  readonly stateFile: string
}

/** The code the operator wrote down, once it is there (five minutes at most). */
const awaitCode = async (codeFile: string) => {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const code = /\b(\d{6})\b/u.exec(await readFile(codeFile, 'utf8').catch(() => ''))?.[1]
    if (code !== undefined) {
      await rm(codeFile, { force: true })
      return code
    }
    await Bun.sleep(500)
  }
  throw new Error('no code arrived')
}

/** A browser context signed in as the account: the kept session when it is still good, else a new sign-in. */
export const signedIn = async (browser: Browser, deployed: Deployed): Promise<BrowserContext> => {
  const { origin, email, codeFile, stateFile } = deployed
  const context = await browser.newContext(existsSync(stateFile) ? { storageState: stateFile } : {})
  if ((await context.request.get(`${origin}/api/pieces`)).status() === 200) return context
  await rm(codeFile, { force: true })
  const page = await context.newPage()
  await page.goto(`${origin}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('heading', { name: 'Check your email' }).waitFor({ state: 'visible' })
  console.log(`code requested; write it to ${codeFile}`)
  await page.getByLabel('Enter verification code').fill(await awaitCode(codeFile))
  await page.waitForURL(`${origin}/`)
  await context.storageState({ path: stateFile })
  await chmod(stateFile, 0o600)
  await page.close()
  return context
}
