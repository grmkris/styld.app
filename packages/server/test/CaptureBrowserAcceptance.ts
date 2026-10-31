import { expect } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { Schema } from 'effect'
import type { Browser, Page } from 'playwright'
import { readMoov, videoDurationMs, videoFrameCount } from '../src/capture/VideoContainer.ts'
import { recordProblems } from './BrowserAcceptance.ts'

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/capture/${name}`, import.meta.url))

/** A stand-in screen wake lock that counts the locks the page asks for and gives back. */
const countedWakeLock = `
  const counts = { requested: 0, released: 0 }
  globalThis.styldWakeLocks = counts
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        counts.requested += 1
        const sentinel = new EventTarget()
        let released = false
        sentinel.release = async () => {
          if (released) return
          released = true
          counts.released += 1
          sentinel.dispatchEvent(new Event('release'))
        }
        return sentinel
      },
    },
  })
`

/** Say what an unnamed found piece is: ticking it opens it, a category keeps it, Done closes it; it is then called
 * what one of its kind is ("Top" for Tops). */
const keepAs = async (page: Page, category: string, kind: string) => {
  await page.getByRole('button', { name: 'Keep Pick a category' }).first().click()
  await page.getByRole('button', { name: category, exact: true }).click()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: `Keep ${kind}`, exact: true }).waitFor({ state: 'visible' })
}

/** Three photos go up through the picker, wait in the review tray, two are kept with a category and
 * the third is dropped; the wardrobe then shows the two. Providers are off natively, so each photo is
 * one found piece without a suggestion. */
export const verifyCaptureJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-capture-browser`, { method: 'POST' })).status).toBe(204)
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  // A visitor who already answered the diagnostics prompt, which otherwise rises over the page's actions.
  await context.addCookies([{ name: 'styld_diagnostics', value: 'denied', url: origin }])
  try {
    const signIn = await context.request.post(`${origin}/api/auth/signIn`, {
      headers: { origin, 'x-effect-auth-csrf': '1' },
      data: { payload: { email: 'native-capture-browser@example.invalid', password: 'native-identity-password-52' } },
    })
    expect(signIn.status()).toBe(200)
    const page = await context.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/wardrobe/add`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Add pieces' }).waitFor({ state: 'visible' })
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles([fixture('red-tee.png'), fixture('blue-dress.png'), fixture('green-shirt.png')])
    await page.waitForURL(`${origin}/wardrobe/review`, { timeout: 30000 })
    await page.getByRole('heading', { name: '3 pieces found' }).waitFor({ state: 'visible', timeout: 30000 })
    expect(await page.getByRole('button', { name: 'Keep Pick a category' }).count()).toBe(3)
    await page.getByText('4 of 7 free credits left today').waitFor({ state: 'visible' })

    await keepAs(page, 'Tops', 'Top')
    await keepAs(page, 'Dresses', 'Dress')
    const add = page.getByRole('button', { name: 'Add 2 to my wardrobe' })
    await add.click()
    await page.waitForURL(`${origin}/wardrobe`, { timeout: 30000 })
    // A tile is named by its picture and its caption, both what one of its kind is.
    await page.getByRole('link', { name: /^Top\b/ }).waitFor({ state: 'visible' })
    await page.getByRole('link', { name: /^Dress\b/ }).waitFor({ state: 'visible' })
    expect(await page.locator('a[href^="/wardrobe/pc_"]').count()).toBe(2)
    // The dropped piece left the tray with the rest.
    await page.goto(`${origin}/wardrobe/review`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'No scans waiting for review' }).waitFor({ state: 'visible' })
    expect(problems).toEqual([])
  } finally {
    await context.close()
  }
}

const PairedTray = Schema.Struct({
  captures: Schema.Array(Schema.Struct({ detections: Schema.Array(Schema.Struct({ hasBack: Schema.Boolean })) })),
})

/** The held-up camera on Chromium's stand-in camera, whose picture never settles, so the shutter takes each
 * photo. It opens over the whole page with the shutter focused and the screen kept on, takes a piece's
 * front and then asks for its back, and closes on Escape. The two photos become one piece with its back in
 * the review tray. */
export const verifyCameraJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-camera-browser`, { method: 'POST' })).status).toBe(204)
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    permissions: ['camera'],
  })
  await context.addCookies([{ name: 'styld_diagnostics', value: 'denied', url: origin }])
  await context.addInitScript({ content: countedWakeLock })
  try {
    const signIn = await context.request.post(`${origin}/api/auth/signIn`, {
      headers: { origin, 'x-effect-auth-csrf': '1' },
      data: { payload: { email: 'native-camera-browser@example.invalid', password: 'native-identity-password-52' } },
    })
    expect(signIn.status()).toBe(200)
    const page = await context.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/wardrobe/add`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Hold pieces up/ }).click()
    const camera = page.getByRole('dialog', { name: 'Camera' })
    await camera.getByText('Hold one piece up, then keep still').waitFor({ state: 'visible', timeout: 15000 })
    // Full screen, with the shutter focused: Enter takes the front.
    expect(await camera.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
    expect(await page.evaluate("document.activeElement?.getAttribute('aria-label')")).toBe('Take a photo')
    await page.keyboard.press('Enter')
    await camera.getByText('Now show its back, or tap the picture').waitFor({ state: 'visible' })
    await camera.getByText('1 taken').waitFor({ state: 'visible' })
    expect(await camera.locator('[aria-current="step"]').textContent()).toBe('Back')
    await camera.getByRole('button', { name: 'Skip the back' }).waitFor({ state: 'visible' })
    await camera.getByRole('button', { name: 'Take a photo' }).click()
    await camera.getByText('Got it. Show the next piece').waitFor({ state: 'visible' })
    expect(await camera.locator('[aria-current="step"]').textContent()).toBe('Front')
    expect(await page.evaluate('globalThis.styldWakeLocks')).toEqual({ requested: 1, released: 0 })

    // Escape closes the camera; with both photos sent the review tray takes over, a new page that holds no
    // lock on the screen.
    await page.keyboard.press('Escape')
    await page.waitForURL(`${origin}/wardrobe/review`, { timeout: 30000 })
    let paired = false
    for (let attempt = 0; attempt < 80 && !paired; attempt += 1) {
      const tray = Schema.decodeUnknownSync(PairedTray)(
        await (await context.request.get(`${origin}/api/captures/tray`)).json(),
      )
      paired = tray.captures.length === 1 && tray.captures[0]?.detections[0]?.hasBack === true
      if (!paired) await Bun.sleep(250)
    }
    expect(paired).toBe(true)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '1 piece found' }).waitFor({ state: 'visible', timeout: 30000 })
    expect(problems).toEqual([])
  } finally {
    await context.close()
  }
}

const Created = Schema.Struct({
  videoUploadId: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  durationMs: Schema.Number,
})

/** A 2:20 video, recorded turned on its side, goes up as 30-second parts the browser cuts itself: each an
 * upright H.264 clip at 4 frames a second without sound. The original never leaves the page. The native
 * allowance pays for the first part and stops the second, which the page reports. */
export const verifyLongVideoJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-video-browser`, { method: 'POST' })).status).toBe(204)
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  await context.addCookies([{ name: 'styld_diagnostics', value: 'denied', url: origin }])
  await context.addInitScript({ content: countedWakeLock })
  try {
    const signIn = await context.request.post(`${origin}/api/auth/signIn`, {
      headers: { origin, 'x-effect-auth-csrf': '1' },
      data: { payload: { email: 'native-video-browser@example.invalid', password: 'native-identity-password-52' } },
    })
    expect(signIn.status()).toBe(200)
    const page = await context.newPage()
    const problems = recordProblems(page)
    const created: Array<typeof Created.Type> = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/captures/video')
        created.push(Schema.decodeUnknownSync(Created)(JSON.parse(request.postData() ?? '{}')))
    })
    await page.goto(`${origin}/wardrobe/add`, { waitUntil: 'networkidle' })
    await page.locator('input[type="file"][multiple]').setInputFiles([fixture('long-rail.mp4')])
    await page.getByText("Today's free allowance covered 1 of 5 parts").waitFor({ state: 'visible', timeout: 90000 })
    // One wake lock held the screen on through both parts, and went back once the video stopped.
    await page.waitForFunction('globalThis.styldWakeLocks.released > 0', undefined, { timeout: 5000 })
    expect(await page.evaluate('globalThis.styldWakeLocks')).toEqual({ requested: 1, released: 1 })

    // Both parts went up; the second was refused when it asked for credits.
    expect(created.length).toBe(2)
    const original = await Bun.file(fixture('long-rail.mp4')).bytes()
    for (const part of created) {
      const stored = await fetch(
        `${fixtures}/test/identity/media-bytes?key=accounts/native-video-browser/uploads/${part.videoUploadId}`,
      )
      expect(stored.status).toBe(200)
      const clip = new Uint8Array(await stored.arrayBuffer())
      expect(clip.byteLength).not.toBe(original.byteLength)
      const moov = await readMoov(
        (offset, length) => Promise.resolve(clip.subarray(offset, offset + length)),
        clip.byteLength,
      )
      if (moov === undefined) throw new Error('a part is an MP4 with a moov box')
      expect(videoFrameCount(moov)).toBe(120)
      expect(videoDurationMs(moov)).toBe(30_000)
      // Only a video track: no sound handler.
      expect(new TextDecoder('latin1').decode(moov).includes('soun')).toBe(false)
    }
    // The parts are upright: the video was recorded turned a quarter.
    for (const part of created) {
      expect(part.height).toBeGreaterThan(part.width)
      expect(part.durationMs).toBe(30_000)
    }
    expect(problems).toEqual([])
  } finally {
    await context.close()
  }
}
