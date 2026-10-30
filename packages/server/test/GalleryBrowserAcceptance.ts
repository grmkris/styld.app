import { expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Schema } from 'effect'
import type { Browser, BrowserContext, Locator, Page } from 'playwright'
import { recordProblems } from './BrowserAcceptance.ts'
import { type Call, client, signIn } from './WardrobeAcceptance.ts'

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/gallery/${name}`, import.meta.url))
/** Set to a folder to keep the journey's screenshots for a person to look at. */
const shots = process.env['STYLD_GALLERY_SHOTS']

const shoot = async (page: Page, name: string) => {
  if (shots !== undefined) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true })
}

/** Nothing on a phone page reaches past the page's edge. The page clips sideways overflow, so `scrollWidth`
 * can't see it: each element's own edge is measured against the page's box, except inside a box that scrolls
 * or clips its contents. */
const expectNoSidewaysScroll = async (page: Page) =>
  expect(
    await page.locator('main').evaluate((main) => {
      const edge = document.documentElement.getBoundingClientRect().right
      const contained = (element: Element) => {
        for (let at = element.parentElement; at !== null && at !== main; at = at.parentElement)
          if (getComputedStyle(at).overflowX !== 'visible') return true
        return false
      }
      return [main, ...main.querySelectorAll('*')]
        .filter((element) => !contained(element))
        .map((element) => ({ element, past: Math.round(element.getBoundingClientRect().right - edge) }))
        .filter(({ past }) => past > 0)
        .map(({ element, past }) => `${element.tagName.toLowerCase()}.${element.className} +${String(past)}px`)
    }),
  ).toEqual([])

const IdOf = Schema.Struct({ id: Schema.String, status: Schema.String })
const UploadOf = Schema.Struct({ uploadId: Schema.String, path: Schema.String })

/** A real cut-out from the owner's wardrobe, sent and added as a piece, then processed until ready. */
const addPiece = async (origin: string, call: Call, file: string, piece: Record<string, unknown>) => {
  const bytes = new Uint8Array(await readFile(fixture(file)))
  const created = await call('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ contentType: 'image/webp', bytes: bytes.byteLength }),
  })
  const upload = Schema.decodeUnknownSync(UploadOf)(await created.json())
  const sent = await fetch(`${origin}${upload.path}`, {
    method: 'PUT',
    headers: { 'content-type': 'image/webp' },
    body: new Blob([bytes]),
  })
  expect(sent.status).toBe(204)
  const added = await call('/api/pieces', {
    method: 'POST',
    body: JSON.stringify({ operationId: `gallery-${file.replace('.webp', '')}`, uploadId: upload.uploadId, ...piece }),
  })
  expect(added.status).toBe(200)
  const { id } = Schema.decodeUnknownSync(IdOf)(await added.json())
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { status } = Schema.decodeUnknownSync(IdOf)(await (await call(`/api/pieces/${id}`)).json())
    if (status !== 'processing') return id
    await Bun.sleep(250)
  }
  throw new Error(`The piece from ${file} never finished processing`)
}

/** A browser signed in as the journey's account: the sign-in sets its session cookie in the context. */
const signedInContext = async (browser: Browser, origin: string, viewport: { width: number; height: number }) => {
  const context = await browser.newContext({ locale: 'en-US', viewport, hasTouch: true })
  // A visitor who already answered the diagnostics prompt, which otherwise rises over the page's actions.
  await context.addCookies([{ name: 'styld_diagnostics', value: 'denied', url: origin }])
  const signedIn = await context.request.post(`${origin}/api/auth/signIn`, {
    headers: { origin, 'x-effect-auth-csrf': '1' },
    data: { payload: { email: 'native-gallery-browser@example.invalid', password: 'native-identity-password-52' } },
  })
  expect(signedIn.status()).toBe(200)
  return context
}

/** Where an item lies, as the editor placed it. */
const placementOf = (item: Locator) =>
  item.evaluate((element) => {
    const style = element instanceof HTMLElement ? element.style : undefined
    return { x: Number(style?.getPropertyValue('--x')), k: Number(style?.getPropertyValue('--k')) }
  })

/** Two fingers on an item, spreading apart: the item grows. */
const pinch = async (context: BrowserContext, page: Page, item: Locator) => {
  const box = await item.boundingBox()
  if (box === null) throw new Error('The item is not on screen')
  const cdp = await context.newCDPSession(page)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: ReadonlyArray<readonly [number, number]>) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([px, py], id) => ({ x: px, y: py, id })) })
  await touch('touchStart', [[x - 15, y]])
  await touch('touchStart', [
    [x - 15, y],
    [x + 15, y],
  ])
  for (const step of [1, 2, 3, 4, 5, 6]) {
    await touch('touchMove', [
      [x - 15 - step * 6, y],
      [x + 15 + step * 6, y],
    ])
    await page.waitForTimeout(16)
  }
  await touch('touchEnd', [])
}

const verifyHome = async (page: Page, origin: string) => {
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
  const table = page.getByRole('img', { name: /^Today’s outfit:/ })
  await table.waitFor({ state: 'visible' })
  expect(await page.locator('#today-headline').textContent()).toMatch(/^[A-Z]{3} \d{1,2}$/)
  await expectNoSidewaysScroll(page)
  await shoot(page, 'phone-home')
  // Spin until the outfit changes; with two tops some spins repeat the same one.
  const before = await table.getAttribute('aria-label')
  for (const _ of Array.from({ length: 12 })) {
    await page.getByRole('button', { name: 'Spin for another outfit' }).click()
    await page.waitForTimeout(400)
    if ((await table.getAttribute('aria-label')) !== before) break
  }
  expect(await table.getAttribute('aria-label')).not.toBe(before)
  await page.waitForTimeout(600)
  await shoot(page, 'phone-home-spun')
  await page.getByRole('button', { name: 'Wear this' }).click()
  await page.getByRole('button', { name: 'Worn today' }).waitFor({ state: 'visible' })
  await page.getByText('Logged for today.').waitFor({ state: 'visible' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Worn today' }).waitFor({ state: 'visible' })
}

const verifyBoard = async (context: BrowserContext, page: Page, origin: string) => {
  await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Boards', level: 1 }).waitFor({ state: 'visible' })
  await page.getByLabel('Name').fill('Weekend')
  await page.getByRole('button', { name: 'New board' }).click()
  await page.waitForURL(/\/boards\/bd_/)
  await page.getByRole('heading', { name: 'Weekend' }).waitFor({ state: 'visible' })
  await expectNoSidewaysScroll(page)
  for (const name of ['Cable knit', 'Denim shorts', 'Derby shoes'])
    await page.getByRole('button', { name: `Put ${name} on the table` }).click()
  const knit = page.getByRole('button', { name: 'Cable knit', exact: true })
  await knit.waitFor({ state: 'visible' })

  await page.waitForTimeout(600)
  await knit.scrollIntoViewIfNeeded()
  const start = await placementOf(knit)
  const box = await knit.boundingBox()
  if (box === null) throw new Error('The knit is not on screen')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const after = await knit.evaluate(
    (element) =>
      `held=${String(element.hasAttribute('data-held'))} selected=${String(element.hasAttribute('data-selected'))}`,
  )
  const hit = await page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x ?? 0, y ?? 0)
      return `${element?.tagName ?? 'none'}.${element?.getAttribute('aria-label') ?? ''} at ${String(x)},${String(y)} scrollY=${String(window.scrollY)}`
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  const moved = (await placementOf(knit)).x
  if (moved <= start.x + 50)
    throw new Error(`The knit did not follow the mouse (${String(start.x)} -> ${String(moved)}, ${after}, top: ${hit})`)

  const shorts = page.getByRole('button', { name: 'Denim shorts', exact: true })
  await shorts.scrollIntoViewIfNeeded()
  const small = await placementOf(shorts)
  await pinch(context, page, shorts)
  await page.waitForTimeout(300)
  expect((await placementOf(shorts)).k).toBeGreaterThan(small.k * 1.2)

  await knit.focus()
  const focused = await placementOf(knit)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(150)
  expect((await placementOf(knit)).x).toBeCloseTo(focused.x + 10, 5)

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.getByLabel('Text', { exact: true }).fill('Weekend in Piran')
  await page.getByRole('button', { name: 'Headline' }).click()
  await page.getByRole('button', { name: 'Text: Weekend in Piran' }).waitFor({ state: 'visible' })

  await page.locator('input[type="file"]').setInputFiles(fixture('shirt-sky.webp'))
  const picture = page.getByRole('button', { name: 'A picture' })
  await picture.waitFor({ state: 'visible', timeout: 30000 })
  expect(
    await picture
      .locator('img')
      .evaluate((image) => image instanceof HTMLImageElement && image.decode().then(() => true)),
  ).toBe(true)

  // Focusing an item selects it, as a keyboard user would.
  const shoes = page.getByRole('button', { name: 'Derby shoes', exact: true })
  await shoes.focus()
  await page.getByRole('button', { name: 'Take off' }).click()
  await page.getByText('Taken off the table.').waitFor({ state: 'visible' })
  expect(await shoes.count()).toBe(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).last().click()
  await shoes.waitFor({ state: 'visible' })

  await page.getByText('Saved', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await shoot(page, 'phone-board')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Text: Weekend in Piran' }).waitFor({ state: 'visible' })
  expect(await page.locator('[data-item]').count()).toBe(5)

  await page.getByRole('button', { name: 'Save as a look' }).click()
  await page.getByText('Saved as a look.').waitFor({ state: 'visible' })
  await page.getByRole('link', { name: 'Open the look' }).click()
  await page.getByRole('heading', { name: 'Weekend' }).waitFor({ state: 'visible' })
}

const verifyAskAndWardrobe = async (page: Page, origin: string) => {
  await page.goto(`${origin}/ask`, { waitUntil: 'networkidle' })
  await page.getByRole('searchbox', { name: 'Search your wardrobe' }).fill('knit')
  await page.getByRole('link', { name: 'Cable knit' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('link', { name: /Add clothes/ }).waitFor({ state: 'visible' })
  await expectNoSidewaysScroll(page)
  await shoot(page, 'phone-ask')
  await page.goto(`${origin}/wardrobe`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: 'Looks' }).click()
  await page.waitForURL(`${origin}/looks`)
  await page.getByRole('link', { name: 'Pieces' }).waitFor({ state: 'visible' })
}

/** Gallery 2 for the person's own wardrobe: today's table (Spin, Wear this), a board laid out by hand (moved,
 * pinched, a label, a picture, taken off and back, saved and reopened, saved as a look), Ask and the
 * Wardrobe's tabs. No page error and no CSP violation on the way: the table places things through the CSSOM. */
export const verifyGalleryJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-gallery-browser`, { method: 'POST' })).status).toBe(204)
  const cookie = await signIn(origin, 'native-gallery-browser')
  const call = client(origin, cookie)
  await addPiece(origin, call, 'knit-cable-navy.webp', { category: 'top', colours: ['navy'], name: 'Cable knit' })
  await addPiece(origin, call, 'shirt-sky.webp', { category: 'top', colours: ['blue'], name: 'Oxford shirt' })
  await addPiece(origin, call, 'shorts-denim.webp', { category: 'bottom', colours: ['blue'], name: 'Denim shorts' })
  await addPiece(origin, call, 'derby-black.webp', { category: 'shoes', colours: ['black'], name: 'Derby shoes' })

  const phone = await signedInContext(browser, origin, { width: 390, height: 844 })
  try {
    const page = await phone.newPage()
    const problems = recordProblems(page)
    try {
      await verifyHome(page, origin)
      await verifyBoard(phone, page, origin)
      await verifyAskAndWardrobe(page, origin)
    } catch (error) {
      await shoot(page, 'phone-failure')
      if (shots !== undefined) {
        const html = await page.locator('main').evaluate((main) => main.outerHTML)
        const computed = await page
          .locator('[role="img"] > div')
          .first()
          .evaluate((item) => {
            const style = getComputedStyle(item)
            return `${item.className} | position=${style.position} translate=${style.translate} width=${style.width}`
          })
          .catch(() => 'no item')
        await Bun.write(`${shots}/phone-failure.html`, `${computed}\n${html}`)
      }
      throw new Error(`${String(error)}; page problems: ${problems.join(' | ')}`, { cause: error })
    }
    expect(problems).toEqual([])
  } finally {
    await phone.close()
  }

  const desk = await signedInContext(browser, origin, { width: 1440, height: 900 })
  try {
    const page = await desk.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
    await page.getByRole('img', { name: /^Today’s outfit:/ }).waitFor({ state: 'visible' })
    await shoot(page, 'desktop-home')
    await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: 'Open Weekend' }).click()
    await page.getByRole('button', { name: 'Text: Weekend in Piran' }).waitFor({ state: 'visible' })
    await shoot(page, 'desktop-board')
    // The same pages in Slovenian: the day in Slovenian, the board's words from the catalog.
    await desk.addCookies([{ name: 'styld_locale', value: 'sl', url: origin }])
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
    await page.getByRole('img', { name: /^Današnja oprava:/ }).waitFor({ state: 'visible' })
    expect(await page.locator('#today-headline').textContent()).toMatch(/^[A-ZČŠŽ]{3} \d{1,2}$/)
    await shoot(page, 'desktop-home-sl')
    await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Zbirke', level: 1 }).waitFor({ state: 'visible' })
    await page.getByRole('link', { name: 'Odpri: Weekend' }).click()
    await page.getByRole('button', { name: 'Besedilo: Weekend in Piran' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Shrani kot videz' }).waitFor({ state: 'visible' })
    await shoot(page, 'desktop-board-sl')
    expect(problems).toEqual([])
  } finally {
    await desk.close()
  }
}
