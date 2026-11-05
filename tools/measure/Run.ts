/**
 * One measurement of a deployed stage, for before/after comparisons of a change (the fix round of 5 November 2026):
 *
 *   STYLD_URL=https://dev.styld.app STYLD_MEASURE_EMAIL=… bun tools/measure/Run.ts [--warm 20]
 *
 * Signs in as the measurement account (`../DeployedSession.ts`: the emailed code goes to `STYLD_CODE_FILE`, default
 * `/tmp/styld-measure-code`), gives it a small wardrobe the first time (fixture photos added by hand: no paid
 * provider call beyond the clean pictures the stage draws for new pieces), then times every journey once cold and
 * `--warm` more times: the account's API reads, the pages in a phone-sized browser (navigation timing, LCP, CLS), the
 * landing signed out, and MCP tools. Afterwards it reads what Cloudflare saw in the window (`Cloudflare.ts`) and
 * keeps the answers it got, normalised, for the behaviour diff. Writes `<out>/<release>/run.json` and `answers/`
 * under `STYLD_MEASURE_OUT` (default `~/private/styld-research/measure`, private: it holds the account's data).
 * `Report.ts` compares two runs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { type APIRequestContext, type BrowserContext, chromium, devices } from 'playwright'
import { csrf } from '../../packages/auth/src/config.ts'
import { stages } from '../../packages/server/src/Resources.ts'
import { signedIn } from '../DeployedSession.ts'
import { logCounts, providerCalls, workerUse } from './Cloudflare.ts'
import { mcpSession } from './Mcp.ts'

const origin = new URL(process.env['STYLD_URL'] ?? '').origin
const email = process.env['STYLD_MEASURE_EMAIL'] ?? ''
if (origin === 'null' || email === '') throw new Error('Set STYLD_URL and STYLD_MEASURE_EMAIL')
const stage = new URL(origin).hostname === 'styld.app' ? 'production' : 'preview'
const warm = Number(process.argv[process.argv.indexOf('--warm') + 1] ?? 20) || 20
const out = process.env['STYLD_MEASURE_OUT'] ?? join(homedir(), 'private/styld-research/measure')
const headers = { origin, [csrf.header]: csrf.value }

const Health = Schema.Struct({ release: Schema.String })
const Upload = Schema.Struct({ uploadId: Schema.String, path: Schema.String })
const Listed = Schema.Struct({ pieces: Schema.Array(Schema.Struct({ id: Schema.String })) })
const Boards = Schema.Struct({ boards: Schema.Array(Schema.Struct({ id: Schema.String })) })

const operationId = () => `measure-${crypto.randomUUID()}`
const fixture = (folder: string, name: string) =>
  readFile(new URL(`../../packages/server/test/fixtures/${folder}/${name}`, import.meta.url))

/** The pieces the account is given once: fixture photos, each added by hand with a type, a name and a colour. */
const wardrobe = [
  ['gallery', 'derby-black.webp', 'image/webp', 'laceUps', 'Black derbies', 'black'],
  ['gallery', 'knit-cable-navy.webp', 'image/webp', 'knitwear', 'Navy cable knit', 'navy'],
  ['gallery', 'shirt-sky.webp', 'image/webp', 'shirts', 'Sky shirt', 'blue'],
  ['gallery', 'shorts-denim.webp', 'image/webp', 'shorts', 'Denim shorts', 'blue'],
  ['capture', 'red-tee.png', 'image/png', 'shortSleeveTops', 'Red tee', 'red'],
  ['capture', 'green-shirt.png', 'image/png', 'shirts', 'Green shirt', 'green'],
  ['capture', 'blue-dress.png', 'image/png', 'dresses', 'Blue dress', 'blue'],
] as const

const seed = async (request: APIRequestContext) => {
  const listed = Schema.decodeUnknownSync(Listed)(await (await request.get(`${origin}/api/pieces`)).json())
  if (listed.pieces.length >= wardrobe.length * 3) return
  for (let round = 0; round < 3; round += 1)
    for (const [folder, name, contentType, type, pieceName, colour] of wardrobe) {
      const bytes = await fixture(folder, name)
      const created = await request.post(`${origin}/api/uploads`, {
        headers,
        data: { operationId: operationId(), contentType, bytes: bytes.byteLength },
      })
      const { uploadId, path } = Schema.decodeUnknownSync(Upload)(await created.json())
      const put = await request.put(`${origin}${path}`, { headers: { 'content-type': contentType }, data: bytes })
      if (put.status() !== 204) throw new Error(`upload of ${name} answered ${put.status()}`)
      const added = await request.post(`${origin}/api/pieces`, {
        headers,
        data: { operationId: operationId(), uploadId, type, name: `${pieceName} ${round + 1}`, colours: [colour] },
      })
      if (!added.ok())
        throw new Error(`adding ${name} answered ${added.status()}: ${(await added.text()).slice(0, 200)}`)
    }
  const pieces = Schema.decodeUnknownSync(Listed)(await (await request.get(`${origin}/api/pieces`)).json()).pieces
  await request.post(`${origin}/api/looks`, {
    headers,
    data: { operationId: operationId(), name: 'Measured look', pieceIds: pieces.slice(0, 3).map(({ id }) => id) },
  })
  await request.post(`${origin}/api/boards`, { headers, data: { operationId: operationId(), name: 'Measured board' } })
}

interface Timing {
  readonly status: number
  readonly bytes: number
  readonly cold: number
  readonly warm: ReadonlyArray<number>
}

const quantile = (values: ReadonlyArray<number>, q: number) => {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

/** Each step once cold, then `warm` more times. */
const timed = async (run: () => Promise<{ status: number; bytes: number }>): Promise<Timing> => {
  const once = async () => {
    const started = performance.now()
    const answer = await run()
    return { ...answer, ms: performance.now() - started }
  }
  const first = await once()
  const rest: number[] = []
  for (let index = 0; index < warm; index += 1) rest.push((await once()).ms)
  return { status: first.status, bytes: first.bytes, cold: first.ms, warm: rest }
}

const apiSteps = (boardId: string) => ({
  pieces: '/api/pieces',
  piece: '',
  looks: '/api/looks',
  boards: '/api/boards',
  board: `/api/boards/${boardId}`,
  feed: '/api/feed',
  photos: '/api/photos',
  tryOns: '/api/try-ons',
  taste: '/api/me/taste',
  profile: '/api/profile',
  credits: '/api/credits',
  tray: '/api/captures/tray',
  searchPublic: '/api/public/search?q=shirt',
})

interface PageReading {
  readonly ttfb: number
  readonly domContentLoaded: number
  readonly load: number
  readonly lcp: number
  readonly cls: number
}

const PageReadingSchema = Schema.Struct({
  ttfb: Schema.Number,
  domContentLoaded: Schema.Number,
  load: Schema.Number,
  lcp: Schema.Number,
  cls: Schema.Number,
})

/** Runs in the page before its own scripts: the largest paint and the layout shifts not caused by input. */
const vitalsScript = `
  const vitals = { lcp: 0, cls: 0 };
  globalThis.styldVitals = vitals;
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) vitals.lcp = entry.startTime })
    .observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) vitals.cls += entry.value })
    .observe({ type: 'layout-shift', buffered: true });
`

/** Read in the page once it has settled. */
const readingScript = `(() => {
  const navigation = performance.getEntriesByType('navigation')[0];
  return {
    ttfb: navigation?.responseStart ?? 0,
    domContentLoaded: navigation?.domContentLoadedEventEnd ?? 0,
    load: navigation?.loadEventEnd ?? 0,
    lcp: globalThis.styldVitals?.lcp ?? 0,
    cls: globalThis.styldVitals?.cls ?? 0,
  };
})()`

/** Navigation timing, LCP and CLS of one page load in a fresh tab. */
const readPage = async (context: BrowserContext, path: string): Promise<PageReading> => {
  const page = await context.newPage()
  await page.addInitScript(vitalsScript)
  await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const reading = Schema.decodeUnknownSync(PageReadingSchema)(await page.evaluate(readingScript))
  await page.close()
  return reading
}

const pageSteps = (boardId: string) => ({
  wardrobe: '/wardrobe',
  boards: '/boards',
  board: `/boards/${boardId}`,
  ask: '/ask',
  looks: '/looks',
  gallery: '/gallery',
})

/** An answer with the parts that change between runs taken out: addresses, times, ids made on the way. */
const normalised = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalised)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/url|image|thumb|picture|signed|at$|At$|expires|token|version/iu.test(key))
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, normalised(inner)]),
  )
}

const searches = ['shirt', 'blue', 'majica', 'knit', 'red tee', 'shoes']

const health = Schema.decodeUnknownSync(Health)(await (await fetch(`${origin}/api/health`)).json())
const folder = join(out, health.release)
await mkdir(join(folder, 'answers'), { recursive: true, mode: 0o700 })
const browser = await chromium.launch({ headless: true })
try {
  const context = await signedIn(browser, {
    origin,
    email,
    codeFile: process.env['STYLD_CODE_FILE'] ?? '/tmp/styld-measure-code',
    stateFile: join(out, 'state.json'),
  })
  const request = context.request
  await seed(request)
  const pieces = Schema.decodeUnknownSync(Listed)(await (await request.get(`${origin}/api/pieces`)).json()).pieces
  const boardId = Schema.decodeUnknownSync(Boards)(await (await request.get(`${origin}/api/boards`)).json()).boards[0]
    ?.id
  if (boardId === undefined || pieces[0] === undefined) throw new Error('the account has no board or piece')
  const started = new Date()

  const api: Record<string, Timing> = {}
  const steps = { ...apiSteps(boardId), piece: `/api/pieces/${pieces[0].id}` }
  for (const [name, path] of Object.entries(steps))
    api[name] = await timed(async () => {
      const response = await request.get(`${origin}${path}`)
      const body = await response.body()
      if (name !== 'tray')
        await writeFile(
          join(folder, 'answers', `api-${name}.json`),
          JSON.stringify(normalised(JSON.parse(body.toString() || 'null')), null, 2),
        )
      return { status: response.status(), bytes: body.byteLength }
    })

  const phone = await browser.newContext({ ...devices['iPhone 13'], storageState: join(out, 'state.json') })
  const visitor = await browser.newContext({ ...devices['iPhone 13'] })
  const pages: Record<string, ReadonlyArray<PageReading>> = {}
  const pageRuns = Math.max(3, Math.round(warm / 4))
  for (const [name, path] of [['landing', '/'] as const, ...Object.entries(pageSteps(boardId))]) {
    const readings: PageReading[] = []
    for (let index = 0; index < pageRuns; index += 1)
      readings.push(await readPage(name === 'landing' ? visitor : phone, path))
    pages[name] = readings
  }

  const mcp = await mcpSession(origin, context)
  const tools: Record<string, Timing> = {}
  for (const q of searches) {
    let answer: unknown = null
    tools[`piece_search:${q}`] = await timed(async () => {
      answer = await mcp.call('piece_search', { q })
      return { status: 200, bytes: JSON.stringify(answer).length }
    })
    await writeFile(
      join(folder, 'answers', `mcp-piece_search-${q.replaceAll(' ', '_')}.json`),
      JSON.stringify(normalised(answer), null, 2),
    )
  }
  for (const q of searches) {
    const response = await request.get(`${origin}/api/public/search?q=${encodeURIComponent(q)}`)
    await writeFile(
      join(folder, 'answers', `web-search-${q.replaceAll(' ', '_')}.json`),
      JSON.stringify(normalised(await response.json()), null, 2),
    )
  }
  await mcp.close()
  await phone.close()
  await visitor.close()

  // Analytics arrive a minute or two late.
  const ended = new Date()
  await Bun.sleep(150_000)
  const window = { from: started, to: new Date(ended.getTime() + 60_000) }
  const facts = stages[stage]
  const run = {
    release: health.release,
    origin,
    stage,
    warm,
    started: started.toISOString(),
    ended: ended.toISOString(),
    pieces: pieces.length,
    api: Object.fromEntries(
      Object.entries(api).map(([name, t]) => [name, { ...t, p50: quantile(t.warm, 0.5), p95: quantile(t.warm, 0.95) }]),
    ),
    tools: Object.fromEntries(
      Object.entries(tools).map(([name, t]) => [
        name,
        { ...t, p50: quantile(t.warm, 0.5), p95: quantile(t.warm, 0.95) },
      ]),
    ),
    pages,
    workers: await workerUse(stage, window),
    logs: await logCounts(stage, window),
    providers: await providerCalls(facts.aiCalls, facts.environment, window),
  }
  await writeFile(join(folder, 'run.json'), JSON.stringify(run, null, 2), { mode: 0o600 })
  console.log(`measured ${health.release} on ${origin}: ${join(folder, 'run.json')}`)
} finally {
  await browser.close()
}
