import { expect } from 'bun:test'
import { Schema } from 'effect'
import type { Browser, Page } from 'playwright'
import { seedAccounts, signedInContext } from './Accounts.ts'
import { recordProblems } from './BrowserAcceptance.ts'
import { guidedCameraFixture } from './GuidedCameraFixture.ts'

const show = (page: Page, scene: 'black' | 'front' | 'back') =>
  page.evaluate(`globalThis.evaScene(${JSON.stringify(scene)})`)

const PiecesWithBack = Schema.Struct({ pieces: Schema.Array(Schema.Struct({ hasBack: Schema.Boolean })) })

/** A deliberately positive, side-confused garment answer isolates client timing and pairing from recognition
 * quality. The real browser camera loop, uploads, queue, tray and wardrobe still run through the native edge. */
export const verifyGuidedCameraJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  const account = 'native-guided-camera'
  await seedAccounts(fixtures, account)
  const context = await signedInContext(browser, origin, account, { permissions: ['camera'] })
  await context.addInitScript({ content: guidedCameraFixture })
  let checks = 0
  await context.route('**/api/captures/check', async (route) => {
    checks += 1
    await route.fulfill({ json: { held: true, side: 'front', samePrevious: false, holding: true } })
  })
  try {
    const page = await context.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/wardrobe/add`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Hold pieces up/ }).click()
    const camera = page.getByRole('dialog', { name: 'Camera' })
    await camera.getByRole('button', { name: 'Take a photo' }).waitFor()
    await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2)
    await show(page, 'black')
    await camera.getByText('Uncover the camera and show one piece').waitFor()
    await page.waitForTimeout(1200)
    expect(checks).toBe(0)
    expect(await camera.locator('[aria-current="step"]').textContent()).toBe('Front')

    // A real change during the count cancels it and does not consume the front slot.
    await show(page, 'front')
    await camera.getByText('3', { exact: true }).waitFor()
    await camera.getByText('2', { exact: true }).waitFor()
    await show(page, 'black')
    await camera.getByText('Uncover the camera and show one piece').waitFor()
    await page.waitForTimeout(1600)
    expect(await camera.getByRole('button', { name: /Finish and review/ }).count()).toBe(0)
    expect(await camera.locator('[aria-current="step"]').textContent()).toBe('Front')

    await show(page, 'front')
    await camera.getByText('3', { exact: true }).waitFor()
    await camera.getByText('2', { exact: true }).waitFor()
    await camera.getByText('1', { exact: true }).waitFor()
    await camera.getByText('1 taken').waitFor()
    expect(await camera.locator('[aria-current="step"]').textContent()).toBe('Back')
    const afterFront = checks
    await page.waitForTimeout(4000)
    expect(checks).toBe(afterFront)

    await show(page, 'black')
    await page.waitForTimeout(400)
    await show(page, 'back')
    await camera.getByText('Got it. Show the next piece').waitFor({ timeout: 15000 })
    expect(await camera.locator('[aria-current="step"]').textContent()).toBe('Front')
    await camera.getByRole('button', { name: 'Finish and review 1 piece' }).click()
    await page.waitForURL(`${origin}/wardrobe/review`, { timeout: 30000 })
    await page.getByRole('heading', { name: '1 piece found' }).waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: 'Keep Choose what it is' }).click()
    await page.getByRole('button', { name: 'Tops & T-shirts', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Add 1 to my wardrobe' }).click()
    await page.waitForURL(`${origin}/wardrobe`, { timeout: 30000 })
    const saved = Schema.decodeUnknownSync(PiecesWithBack)(
      await (await context.request.get(`${origin}/api/pieces`)).json(),
    )
    expect(saved.pieces).toEqual([{ hasBack: true }])
    expect(problems).toEqual([])
  } finally {
    await context.close()
  }
}
