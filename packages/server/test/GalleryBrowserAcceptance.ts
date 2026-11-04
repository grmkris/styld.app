import { expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Schema } from 'effect'
import type { Browser, BrowserContext, Locator, Page } from 'playwright'
import { recordProblems } from './BrowserAcceptance.ts'
import {
  expectInstantTabs,
  expectSameTitleTops,
  expectSlovenianSearch,
  expectSteadyFullLoads,
  recordLayoutShifts,
} from './LayoutBrowserAcceptance.ts'
import { type Call, client, seedAccounts, signedInContext, signIn } from './Accounts.ts'

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/gallery/${name}`, import.meta.url))
/** Set to a folder to keep the journey's screenshots for a person to look at. */
const shots = process.env['STYLD_GALLERY_SHOTS']

export const shoot = async (page: Page, name: string) => {
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
export const addPiece = async (origin: string, call: Call, file: string, piece: Record<string, unknown>) => {
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

/** A browser signed in as the journey's account, touch on. */
const journeyContext = (
  browser: Browser,
  origin: string,
  viewport: { width: number; height: number },
  answered = true,
) => signedInContext(browser, origin, 'native-gallery-browser', { viewport, answered, hasTouch: true })

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

/** The round + opens a new board directly on its table; Edit still renames it. */
const openNewBoard = async (page: Page, origin: string) => {
  await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Laboratory', level: 1 }).waitFor({ state: 'visible' })
  // + opens the new-board sheet (F-26); Blank makes a board under the default name.
  await page.getByRole('button', { name: 'New board' }).click()
  await page.getByRole('dialog', { name: 'New board' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /^Blank board/ }).click()
  await page.waitForURL(/\/boards\/bd_[^/]+$/)
  await page.getByRole('heading', { name: 'My board', level: 1 }).waitFor({ state: 'visible' })
  await page.getByRole('region', { name: 'The table' }).waitFor({ state: 'visible' })
  expect(await page.getByRole('navigation', { name: 'Navigation' }).isVisible()).toBe(false)
  await expectNoSidewaysScroll(page)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Board name').fill('Weekend')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: 'Weekend', level: 1 }).waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: 'Weekend' }).waitFor({ state: 'visible' })
}

/** Select mode: the knit and the shorts, ticked from the keyboard (Space on a focused piece ticks it, as a tap does),
 * become a look pinned on the board (T-16). */
const keepTwoAsLook = async (page: Page) => {
  await page.getByRole('button', { name: 'Select pieces' }).click()
  for (const name of ['Cable knit', 'Denim shorts']) {
    await page.getByRole('button', { name, exact: true }).focus()
    await page.keyboard.press('Space')
    await page.getByRole('button', { name, exact: true, pressed: true }).waitFor({ state: 'attached' })
  }
  await page.getByRole('button', { name: 'Save 2 pieces as a look' }).click()
  await page.getByText('Saved as a look and pinned on this board.').waitFor({ state: 'visible' })
}

const verifyBoard = async (context: BrowserContext, page: Page, origin: string) => {
  await openNewBoard(page, origin)
  // The editor has the whole phone screen: the navigation pill would sit over the tray of pieces.
  expect(await page.getByRole('navigation', { name: 'Navigation' }).isVisible()).toBe(false)
  await expectNoSidewaysScroll(page)
  for (const name of ['Cable knit', 'Denim shorts', 'Derby shoes']) {
    await page.getByRole('button', { name: 'Add your piece', exact: true }).click()
    await page.getByRole('button', { name: `Put ${name} on the table` }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
  }
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

  await keepTwoAsLook(page)
  await page.getByRole('link', { name: 'Open the look' }).click()
  await page.getByRole('heading', { name: 'Weekend' }).waitFor({ state: 'visible' })
  await verifyBoardPage(page, origin)
}

/** The board's page: what the collage placed is pinned, newest first, with the picture; a pin comes off the
 * board; the board is renamed from its settings. */
const verifyBoardPage = async (page: Page, origin: string) => {
  await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
  // A board's tile reads as its name and pin count.
  await page.getByRole('link', { name: /^Weekend/ }).click()
  await page.getByRole('heading', { name: 'Weekend', level: 1 }).waitFor({ state: 'visible' })
  await page.getByText('5 pins').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  for (const name of ['Cable knit', 'Denim shorts', 'Derby shoes', 'A picture'])
    await page.getByRole('img', { name, exact: true }).first().waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Take Derby shoes off the board' }).click()
  await page.getByRole('button', { name: 'Take off', exact: true }).click()
  await page.getByText('4 pins').waitFor({ state: 'visible' })
  await shoot(page, 'phone-board-page')

  const name = page.getByLabel('Board name')
  await name.fill('Weekend away')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: 'Weekend away', level: 1 }).waitFor({ state: 'visible' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Weekend away', level: 1 }).waitFor({ state: 'visible' })
  await page.getByText('4 pins').waitFor({ state: 'visible' })

  // The piece taken off goes back on from its own page.
  // The wardrobe opens on its groups; a type's own page lists its pieces (T-07).
  await page.goto(`${origin}/wardrobe?group=shoes&type=trainers`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: 'Derby shoes', exact: true }).first().click()
  await page.getByRole('button', { name: 'Add to board' }).click()
  await page.getByRole('button', { name: /^Weekend away/ }).click()
  await page.getByText('Saved to Weekend away').waitFor({ state: 'visible' })
  await page.getByRole('link', { name: 'Open', exact: true }).click()
  await page.getByText('5 pins').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Derby shoes', exact: true }).waitFor({ state: 'visible' })
  expect(await page.locator('[data-item]').count()).toBe(5)
}

const verifyAskAndWardrobe = async (page: Page, origin: string) => {
  await page.goto(`${origin}/wardrobe`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: 'Search your wardrobe' }).click()
  await page.waitForURL(`${origin}/ask`)
  await page.getByRole('searchbox', { name: 'Search your wardrobe' }).fill('knit')
  await page.getByRole('link', { name: 'Cable knit' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Add clothes or a board', exact: true }).click()
  await page.getByRole('link', { name: /Add clothes/ }).waitFor({ state: 'visible' })
  await expectNoSidewaysScroll(page)
  await shoot(page, 'phone-ask')
  // The Lab opens on Boards; its tabs lead to Looks (T-08).
  await page.goto(`${origin}/wardrobe`, { waitUntil: 'networkidle' })
  await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name: 'Lab', exact: true }).click()
  await page.waitForURL(`${origin}/boards`)
  await page.getByRole('link', { name: 'Looks', exact: true }).click()
  await page.waitForURL(`${origin}/looks`)
  await page.getByRole('link', { name: 'Gallery', exact: true }).waitFor({ state: 'visible' })
}

/** Styld from Ask: what was typed goes to Styld, whose reply its chat's Thread writes with the stand-in model, its
 * words shown as they come, the piece it shows one tap away; coming back opens the chat again, and New chat starts over. */
const verifyStylist = async (page: Page, origin: string) => {
  const question = 'what goes with the knit'
  await page.goto(`${origin}/ask`, { waitUntil: 'networkidle' })
  await page.getByRole('searchbox', { name: 'Search your wardrobe' }).fill(question)
  await page.getByRole('link', { name: `Ask Styld about “${question}”` }).click()
  await page.waitForURL(`${origin}/ask/stylist?q=what+goes+with+the+knit`)
  expect(await page.getByRole('textbox', { name: 'Message to Styld' }).inputValue()).toBe(question)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('list', { name: question }).waitFor({ state: 'visible' })
  // The reply's words show as they are written (its Thread's live text), before the whole reply is in the chat.
  await page.getByText(/^\s*Wear( your)?( \w+)?\s*$/).waitFor({ state: 'visible', timeout: 30000 })
  await page.getByText(/^Wear your \w+ today\.$/).waitFor({ state: 'visible', timeout: 30000 })
  // The card comes with the reply as the chat holds it, from the recorded pieces_show.
  await page.getByRole('list', { name: 'Pieces Styld suggests' }).waitFor({ state: 'visible', timeout: 30000 })
  const shown = page.getByRole('list', { name: 'Pieces Styld suggests' }).getByRole('link')
  expect(await shown.count()).toBe(1)
  expect(await shown.getAttribute('href')).toMatch(/^\/wardrobe\/pc_/)
  // The suggested piece's picture arrives under the page's CSP, from the wardrobe's own images.
  await page.waitForFunction(() => {
    const image = document.querySelector('ul[aria-label="Pieces Styld suggests"] img')
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
  })
  await expectNoSidewaysScroll(page)
  await shoot(page, 'phone-stylist')
  // At the chat's end the footer follows the paper under the composer whole: its language picker is what a tap
  // at it reaches, not the composer.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  const language = await page.locator('footer select').first().boundingBox()
  const reached = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('footer select') !== null,
    { x: (language?.x ?? 0) + (language?.width ?? 0) / 2, y: (language?.y ?? 0) + (language?.height ?? 0) / 2 },
  )
  expect(reached).toBe(true)
  await page.goto(`${origin}/wardrobe`, { waitUntil: 'networkidle' })
  await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name: 'Ask', exact: true }).click()
  await page.waitForURL(`${origin}/ask/stylist`)
  expect(await page.getByRole('searchbox').count()).toBe(0)
  await page.getByRole('list', { name: question }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'New chat' }).click()
  await page.getByRole('button', { name: 'What should I wear today?' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: question }).waitFor({ state: 'visible' })
}

/** On a phone, the diagnostics prompt's answers are what a tap at them reaches, not the navigation floating there. */
const expectConsentReachable = async (browser: Browser, origin: string) => {
  const phone = await journeyContext(browser, origin, { width: 390, height: 844 }, false)
  try {
    const page = await phone.newPage()
    await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
    for (const name of ['Allow', 'No thanks']) {
      const answer = page.getByRole('button', { name, exact: true })
      const box = await answer.boundingBox()
      const reached = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null,
        { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
      )
      expect(reached).toBe(name)
    }
  } finally {
    await phone.close()
  }
}

/** The signed-in pages that must load whole without anything moving. */
const steadyPaths = ['/', '/explore', '/wardrobe', '/looks', '/boards', '/ask', '/ask/stylist', '/account']

/** Gallery 2 for the person's own wardrobe: today's table (Spin, Wear this), a board laid out by hand (moved,
 * pinched, a label, a picture, taken off and back, saved and reopened, saved as a look), Ask, Styld and the
 * Wardrobe's tabs. No page error and no CSP violation on the way: the table places things through the CSSOM. */
/** The wardrobe on the narrowest phone keeps to the screen, and its filter sheet, on a phone held sideways, still
 * shows its title and close button. */
const verifyNarrowWardrobe = async (browser: Browser, origin: string) => {
  const narrow = await journeyContext(browser, origin, { width: 360, height: 740 })
  try {
    const page = await narrow.newPage()
    // Filters belong to a type's own grid, the wardrobe's last step down (T-07).
    await page.goto(`${origin}/wardrobe?group=clothing&type=tops`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Filters' }).waitFor({ state: 'visible' })
    await expectNoSidewaysScroll(page)
    await page.setViewportSize({ width: 667, height: 375 })
    await page.getByRole('button', { name: 'Filters' }).click()
    const title = page.getByRole('heading', { name: 'Filter your wardrobe' })
    await title.waitFor({ state: 'visible' })
    expect((await title.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0)
  } finally {
    await narrow.close()
  }
}

export const verifyGalleryJourney = async (browser: Browser, origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, 'native-gallery-browser')
  const cookie = await signIn(origin, 'native-gallery-browser')
  const call = client(origin, cookie)
  await addPiece(origin, call, 'knit-cable-navy.webp', { type: 'tops', colours: ['navy'], name: 'Cable knit' })
  await addPiece(origin, call, 'shirt-sky.webp', { type: 'tops', colours: ['blue'], name: 'Oxford shirt' })
  await addPiece(origin, call, 'shorts-denim.webp', { type: 'trousers', colours: ['blue'], name: 'Denim shorts' })
  await addPiece(origin, call, 'derby-black.webp', { type: 'trainers', colours: ['black'], name: 'Derby shoes' })
  await expectConsentReachable(browser, origin)

  const phone = await journeyContext(browser, origin, { width: 390, height: 844 })
  try {
    await recordLayoutShifts(phone)
    const page = await phone.newPage()
    const problems = recordProblems(page)
    try {
      await verifyHome(page, origin)
      await verifyBoard(phone, page, origin)
      await verifyAskAndWardrobe(page, origin)
      await verifyStylist(page, origin)
      await expectSameTitleTops(page, origin)
      await expectSteadyFullLoads(page, origin, steadyPaths)
      await expectInstantTabs(page, origin)
      await expectSlovenianSearch(phone, page, origin)
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

  const desk = await journeyContext(browser, origin, { width: 1440, height: 900 })
  try {
    const page = await desk.newPage()
    const problems = recordProblems(page)
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
    await page.getByRole('img', { name: /^Today’s outfit:/ }).waitFor({ state: 'visible' })
    await shoot(page, 'desktop-home')
    await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: /^Weekend away/ }).click()
    await page.getByRole('heading', { name: 'Weekend away', level: 1 }).waitFor({ state: 'visible' })
    await shoot(page, 'desktop-board-page')
    await page.getByRole('button', { name: 'Text: Weekend in Piran' }).waitFor({ state: 'visible' })
    await shoot(page, 'desktop-board')
    // Beside the rail the heads that carry a named action (Add clothes) or a search keep the title level with Boards'.
    await expectSameTitleTops(page, origin, ['/wardrobe', '/looks', '/boards', '/explore'])
    // The same pages in Slovenian: the day in Slovenian, the board's words from the catalog.
    await desk.addCookies([{ name: 'styld_locale', value: 'sl', url: origin }])
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
    await page.getByRole('img', { name: /^Današnja oprava:/ }).waitFor({ state: 'visible' })
    expect(await page.locator('#today-headline').textContent()).toMatch(/^[A-ZČŠŽ]{3} \d{1,2}$/)
    await shoot(page, 'desktop-home-sl')
    await page.goto(`${origin}/boards`, { waitUntil: 'networkidle' })
    // Boards is the Lab's first tab, under the Lab's own title (T-08).
    await page.getByRole('heading', { name: 'Laboratorij', level: 1 }).waitFor({ state: 'visible' })
    await page.getByRole('link', { name: /^Weekend away/ }).click()
    // Five pins: the look kept from the board, and the piece taken off saved back from its own page.
    await page.getByText('5 kartic').waitFor({ state: 'visible' })
    await page.getByRole('region', { name: 'Miza' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Besedilo: Weekend in Piran' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Shrani kot videz' }).waitFor({ state: 'visible' })
    await shoot(page, 'desktop-board-sl')
    expect(problems).toEqual([])
  } finally {
    await desk.close()
  }
  await verifyNarrowWardrobe(browser, origin)
}
