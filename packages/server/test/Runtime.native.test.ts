import { expect } from 'bun:test'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import * as Test from '@alchemy.run/test/Bun'
import { Effect, Schedule, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { type Browser, chromium } from 'playwright'
import { seedAccounts, signInBody } from './Accounts.ts'
import { testPassword } from './IdentityFixture.ts'
import { verifyBrowser } from './BrowserAcceptance.ts'
import { verifyBackfill, verifyCleanPictures } from './CleanPictureAcceptance.ts'
import { verifyTurn } from './TurnAcceptance.ts'
import { verifyCameraJourney, verifyCaptureJourney, verifyLongVideoJourney } from './CaptureBrowserAcceptance.ts'
import { verifyGuidedCameraJourney } from './GuidedCameraBrowserAcceptance.ts'
import { verifyGalleryJourney } from './GalleryBrowserAcceptance.ts'
import { verifyCaptures } from './CaptureAcceptance.ts'
import { verifyScan } from './ScanAcceptance.ts'
import { verifyStylist } from './StylistAcceptance.ts'
import { verifyGallery } from './GalleryAcceptance.ts'
import { verifyBoardOutfits } from './BoardOutfitsAcceptance.ts'
import { verifyOutfitBoardJourney } from './BoardOutfitsBrowserAcceptance.ts'
import { verifySocial } from './SocialAcceptance.ts'
import { verifyGeneration } from './GenerationAcceptance.ts'
import { verifyOutfits } from './OutfitAcceptance.ts'
import { verifyPhotos } from './PhotosAcceptance.ts'
import { verifyImports } from './ImportAcceptance.ts'
import { verifySeed } from './SeedAcceptance.ts'
import { verifyFirstSignedInTogether } from './SessionSetupAcceptance.ts'
import { verifyPublicJourney } from './SocialBrowserAcceptance.ts'
import { verifyBrowserIdentity } from './IdentityBrowserAcceptance.ts'
import { verifyMcp } from './McpAcceptance.ts'
import { verifyAccountDeletion, verifyWardrobe } from './WardrobeAcceptance.ts'
import { verifyMediaLoad } from './MediaLoadAcceptance.ts'
import { verifyNavigationJourney } from './NavigationBrowserAcceptance.ts'
import { LiveSchema, liveShape } from './SchemaShape.ts'
import { snapshotShape } from './SchemaSnapshot.ts'
import { makeStack } from './RuntimeStack.ts'
import { csrf } from '@styld/auth/config'

const Stack = makeStack('before')

class RestartPending extends Schema.TaggedError<RestartPending>()('RestartPending', {}) {}

const authCall =
  (origin: string) =>
  (action: string, payload: object, cookie = '') =>
    HttpClient.post(`${origin}/api/auth/${action}`, {
      headers: {
        origin: new URL(origin).origin,
        'content-type': 'application/json',
        [csrf.header]: csrf.value,
        cookie,
      },
      body: HttpBody.text(JSON.stringify({ payload }), 'application/json'),
    })

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Alchemy.localState(),
  stage: 'local-native',
  dev: true,
  sidecar: { omitEnv: ['CLOUDFLARE_'] },
})
// The local service-binding proxy may return 503 while a dependency is still
// compiling. Its direct development URL waits for startup before dispatching.
const stack = beforeAll(
  deploy(Stack).pipe(
    Effect.tap(({ apiUrl }) => HttpClient.get(`${apiUrl}/api/health`).pipe(Effect.provide(FetchHttpClient.layer))),
    Effect.tap(({ websiteUrl }) => HttpClient.get(websiteUrl).pipe(Effect.provide(FetchHttpClient.layer))),
  ),
  { timeout: 120000 },
)
afterAll(destroy(Stack), { timeout: 60000 })

/** Run a browser acceptance against the public edge in a fresh headless Chromium, whose camera is
 * Chromium's own stand-in picture, allowed without asking. */
const inBrowser = (verify: (browser: Browser, origin: string, testUrl: string) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { url, styldUrl } = yield* stack
      const browserInstance = yield* Effect.acquireRelease(
        Effect.promise(() =>
          chromium.launch({
            headless: true,
            args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
          }),
        ),
        (browser) => Effect.promise(() => browser.close()),
      )
      yield* Effect.promise(() => verify(browserInstance, styldUrl, url))
    }),
  )

/** Run an HTTP acceptance against the public edge, with the test Worker's URL for its seeds. */
const overHttp = (verify: (origin: string, testUrl: string) => Promise<void>) =>
  Effect.gen(function* () {
    const { url, styldUrl } = yield* stack
    yield* Effect.promise(() => verify(styldUrl, url))
  })

test('loads board, Gallery and review pictures in cookie-free bursts', overHttp(verifyMediaLoad), { timeout: 120000 })

test('keeps wardrobe filters, return destinations and clean board history', inBrowser(verifyNavigationJourney), {
  timeout: 120000,
})

test(
  'serves MCP to OAuth clients: discovery, registration, consent, both protocol eras, rotation and revocation',
  overHttp(verifyMcp),
  { timeout: 120000 },
)

test(
  "keeps each account's pieces (upload checks, idempotent adds, queue processing, private images, edits, deletion) and deletes accounts",
  overHttp((origin, testUrl) => verifyWardrobe(origin, testUrl).then(() => verifyAccountDeletion(origin, testUrl))),
  { timeout: 120000 },
)

// The green shirt's clean picture, once taken, is what turns.
test(
  'draws clean pictures, then turns one on its hanger: made on the queue, cut into frames here, checked, played on tap',
  inBrowser((browser, origin, testUrl) =>
    verifyCleanPictures(origin, testUrl).then((pieces) => verifyTurn(browser, origin, testUrl, pieces)),
  ),
  { timeout: 260000 },
)

test(
  'draws a clean picture for every piece that has none when the operator asks, once, paid by Styld',
  overHttp(verifyBackfill),
  { timeout: 90000 },
)

test(
  "keeps each account's boards (idempotent creates, versioned saves, refused items, private pictures), worn days and website looks",
  overHttp(verifyGallery),
  { timeout: 60000 },
)

test(
  'keeps outfits put together on a board as looks pinned on it, and builds six complete outfits around one piece',
  overHttp(verifyBoardOutfits),
  { timeout: 120000 },
)

test(
  'starts a board from the new-board sheet around one piece, keeps an outfit as a look and says when there is no other',
  inBrowser(verifyOutfitBoardJourney),
  { timeout: 120000 },
)

test('keeps profiles and checks whatever goes public first', overHttp(verifySocial), { timeout: 60000 })
test('makes stickers and mood boards of the person’s pieces for a board, once each', overHttp(verifyGeneration), {
  timeout: 90000,
})
test(
  'keeps the person’s outfit photos private: finding garments for a credit, matching, favourites and deletion',
  overHttp(verifyPhotos),
  { timeout: 60000 },
)
test(
  'imports a v1 wardrobe for an admin, into the account its email signs in to or one made for it, once',
  overHttp(verifyImports),
  { timeout: 90000 },
)
test(
  'seeds a house account’s profile and boards for the operator only, once, public once whole, in its reader’s language',
  overHttp(verifySeed),
  { timeout: 90000 },
)
test(
  'makes ranked outfits of the person’s own pieces, Fast and Thinking, never repeating one and keeping their pace and cap',
  overHttp(verifyOutfits),
  { timeout: 90000 },
)
test('shows a published profile and its public board to a signed-out visitor', inBrowser(verifyPublicJourney), {
  timeout: 60000,
})

test(
  'turns photos and videos into captures that wait for review, meters them daily, keeps them private, and shows a ' +
    'garment seen across an import once',
  overHttp((origin, testUrl) => verifyCaptures(origin, testUrl).then(() => verifyScan(origin, testUrl))),
  { timeout: 180000 },
)

test('lets Styld answer about the person’s own wardrobe, once per message, privately', overHttp(verifyStylist), {
  timeout: 120000,
})

test(
  'adds photos through the picker, keeps the ticked ones from the review tray and shows them in the wardrobe',
  inBrowser(verifyCaptureJourney),
  { timeout: 90000 },
)

test(
  'opens the camera over the whole page, takes a piece front then back, and pairs them in the tray',
  inBrowser((browser, origin, fixtures) =>
    verifyCameraJourney(browser, origin, fixtures).then(() => verifyGuidedCameraJourney(browser, origin, fixtures)),
  ),
  { timeout: 150000 },
)

test(
  'cuts a long, turned video into upright parts in the browser and stops at the daily allowance',
  inBrowser(verifyLongVideoJourney),
  { timeout: 120000 },
)

test(
  "lays out today's table (Spin, Wear this), a board by hand (move, pinch, label, picture, undo, save as a look), Ask, Styld and the Wardrobe's tabs",
  inBrowser(verifyGalleryJourney),
  { timeout: 120000 },
)

test('hydrates the built website and persists locale changes in a browser', inBrowser(verifyBrowser), {
  timeout: 60000,
})

test(
  'creates an account with one email code, signs in again with the next, and revokes the session on logout',
  inBrowser(verifyBrowserIdentity),
  { timeout: 60000 },
)

test(
  'formats Slovenian with the real Worker Intl implementation',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/intl`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({ en: '2 pieces', sl: '102 kosa', plural: 'two', date: '1970' })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves the built Foldkit document and assets through the public edge',
  Effect.gen(function* () {
    const { styldUrl } = yield* stack
    const document = yield* HttpClient.get(styldUrl, { headers: { accept: 'text/html' } })
    const html = yield* document.text
    expect(document.status).toBe(200)
    expect(document.headers['content-type']).toContain('text/html')
    expect(html).toContain('A wardrobe shaped by you.')
    const scriptPath = html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]
    const stylesheetPath = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)"/)?.[1]
    expect(scriptPath).toBeDefined()
    expect(stylesheetPath).toBeDefined()
    const script = yield* HttpClient.get(`${styldUrl}${scriptPath}`)
    const stylesheet = yield* HttpClient.get(`${styldUrl}${stylesheetPath}`)
    expect(script.status, `edge asset ${scriptPath}`).toBe(200)
    expect(yield* script.text).toContain('hydrate')
    expect(stylesheet.status, `edge asset ${stylesheetPath}`).toBe(200)
    expect(yield* stylesheet.text).toContain('--z-styld-color-paper')
    // Static files bypass the edge Worker; public/_headers secures them, SVG documents included.
    const icon = yield* HttpClient.get(`${styldUrl}/favicon.svg`)
    expect(icon.status).toBe(200)
    expect(icon.headers['x-content-type-options']).toBe('nosniff')
    expect(icon.headers['content-security-policy']).toContain("default-src 'none'")
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves health but no storage internals through the actual application Worker',
  Effect.gen(function* () {
    const { styldUrl } = yield* stack
    const health = yield* HttpClient.get(`${styldUrl}/api/health`)
    expect(health.status).toBe(200)
    expect(yield* health.json).toMatchObject({ service: 'styldappv2', status: 'ok' })

    const storage = yield* HttpClient.get(`${styldUrl}/api/storage`)
    expect(storage.status).toBe(404)
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'enforces Origin and CSRF on the actual application Worker',
  Effect.gen(function* () {
    const { styldUrl } = yield* stack
    const missingHeaders = yield* HttpClient.post(`${styldUrl}/api/auth/getSession`, {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: HttpBody.text('{}', 'application/json'),
    })
    expect(missingHeaders.status).toBe(403)

    const valid = yield* HttpClient.post(`${styldUrl}/api/auth/getSession`, {
      headers: new Headers({
        origin: new URL(styldUrl).origin,
        'content-type': 'application/json',
        [csrf.header]: csrf.value,
      }),
      body: HttpBody.text('{}', 'application/json'),
    })
    expect(valid.status).toBe(200)
    expect(yield* valid.json).toMatchObject({ _tag: 'Success' })

    const wrongOrigin = yield* HttpClient.post(`${styldUrl}/api/auth/getSession`, {
      headers: new Headers({
        origin: 'https://evil.invalid',
        'content-type': 'application/json',
        [csrf.header]: csrf.value,
      }),
      body: HttpBody.text('{}', 'application/json'),
    })
    expect(wrongOrigin.status).toBe(403)

    const unknownRoute = yield* HttpClient.get(`${styldUrl}/api/health-other`)
    expect(unknownRoute.status).toBe(404)
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serializes competing reservations in native SQLite Durable Objects',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/wallet`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({
      successful: 1,
      reserved: { daily: { remaining: 2 } },
      settled: { daily: { remaining: 10 }, reservations: {} },
      other: { daily: { day: null, remaining: 0 }, reservations: {} },
    })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves the D1 schema its latest migration snapshot records, and the R2 binding',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/storage`)
    expect(response.status).toBe(200)
    const storage = yield* Effect.flatMap(
      response.json,
      Schema.decodeUnknownEffect(
        Schema.Struct({ database: LiveSchema, media: Schema.Struct({ sentinel: Schema.Boolean }) }),
      ),
    )
    expect(liveShape(storage.database)).toEqual(snapshotShape())
    expect(storage.media).toEqual({ sentinel: false })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves Yielded Auth session reads through the native Worker router',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.post(`${url}/api/auth/getSession`, {
      headers: new Headers({
        origin: 'http://localhost',
        'content-type': 'application/json',
        [csrf.header]: csrf.value,
      }),
      body: HttpBody.text('{}', 'application/json'),
    })
    const body = yield* response.text
    expect(response.status, body).toBe(200)
    const payload: unknown = JSON.parse(body)
    expect(payload).toMatchObject({ _tag: 'Success' })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'authenticates, rejects password signup, logs out and immediately invalidates disabled accounts',
  Effect.gen(function* () {
    const { url, styldUrl } = yield* stack
    yield* Effect.promise(() => seedAccounts(url, 'native-identity'))
    const call = authCall(styldUrl)
    // The typed API reads the same session: refused without one, the account's wardrobe with one.
    const me = (cookie?: string) =>
      HttpClient.get(`${styldUrl}/api/pieces`, cookie === undefined ? {} : { headers: new Headers({ cookie }) })
    expect((yield* me()).status).toBe(401)
    const credentials = signInBody('native-identity').payload
    const denied = yield* call('signIn', { ...credentials, password: 'incorrect-password' })
    expect(yield* denied.json).toMatchObject({ _tag: 'Failure' })
    const signup = yield* call('register', credentials)
    expect(signup.status).toBe(404)
    const login = yield* call('signIn', credentials)
    const loginBody = yield* login.text
    expect(login.status, loginBody).toBe(200)
    expect(JSON.parse(loginBody)).toMatchObject({
      _tag: 'Success',
      value: { _tag: 'Authenticated', session: { subjectId: 'native-identity' } },
    })
    const cookie = Object.entries(login.cookies.cookies)
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    expect(cookie.length).toBeGreaterThan(0)
    const account = yield* me(cookie)
    expect(account.status).toBe(200)
    expect(yield* account.json).toEqual({ pieces: [] })
    const session = yield* call('getSession', {}, cookie)
    expect(yield* session.json).toMatchObject({
      _tag: 'Success',
      value: { subjectId: 'native-identity', claims: { displayName: 'Native Identity', emailVerified: true } },
    })
    const cachedCookie = Object.entries({ ...login.cookies.cookies, ...session.cookies.cookies })
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const logout = yield* call('signOut', {}, cachedCookie)
    expect(yield* logout.json).toMatchObject({ _tag: 'Success' })
    const stale = yield* call('getSession', {}, cachedCookie)
    expect(yield* stale.json).toMatchObject({ _tag: 'Success', value: null })
    expect((yield* me(cachedCookie)).status).toBe(401)
    const again = yield* call('signIn', credentials)
    const againCookie = Object.entries(again.cookies.cookies)
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const cachedSession = yield* call('getSession', {}, againCookie)
    const disabledCookie = Object.entries({ ...again.cookies.cookies, ...cachedSession.cookies.cookies })
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const disable = yield* HttpClient.post(`${url}/test/identity/disable`)
    expect(disable.status).toBe(204)
    const disabled = yield* call('getSession', {}, disabledCookie)
    expect(yield* disabled.json).toMatchObject({ _tag: 'Success', value: null })
    expect((yield* me(disabledCookie)).status).toBe(401)
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'retains password attempt budgets across separate application requests',
  Effect.gen(function* () {
    const { url, styldUrl } = yield* stack
    yield* Effect.promise(() => seedAccounts(url, 'native-limited'))
    const attempt = () =>
      HttpClient.post(`${styldUrl}/api/auth/signIn`, {
        headers: { origin: new URL(styldUrl).origin, 'content-type': 'application/json', [csrf.header]: csrf.value },
        body: HttpBody.text(
          JSON.stringify({
            payload: signInBody('native-limited').payload,
          }),
          'application/json',
        ),
      })
    for (let count = 0; count < 10; count += 1) {
      const accepted = yield* attempt()
      expect(yield* accepted.json).toMatchObject({ _tag: 'Success', value: { _tag: 'Authenticated' } })
    }
    const refused = yield* attempt()
    expect(yield* refused.json).toMatchObject({ _tag: 'Failure', error: { _tag: 'PasswordRejected' } })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serializes attempt admission, retains fractional refill and expires private buckets',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.post(`${url}/test/identity/limits`)
    expect(response.status).toBe(200)
    const body: unknown = yield* response.json
    expect(body).toMatchObject({ accepted: 3, rejected: 9, keysAreDigests: true, refilled: true, expired: true })
    if (typeof body !== 'object' || body === null || !('fraction' in body)) throw new Error('Missing refill fraction')
    expect(typeof body.fraction).toBe('number')
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'recovers native wallet receipts, auth sessions and R2 bytes after a Worker restart',
  Effect.gen(function* () {
    const { url, styldUrl } = yield* stack
    expect((yield* HttpClient.post(`${url}/test/recovery/seed`)).status).toBe(204)
    const callAuth = authCall(styldUrl)
    const login = yield* callAuth('signIn', {
      email: 'native-recovery@example.invalid',
      password: testPassword,
    })
    expect(yield* login.json).toMatchObject({ _tag: 'Success', value: { _tag: 'Authenticated' } })
    const cookie = Object.entries(login.cookies.cookies)
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const read = () => HttpClient.get(`${url}/test/recovery/read`).pipe(Effect.flatMap((response) => response.json))
    expect(yield* read()).toMatchObject({ generation: 'before', reads: 1, wallet: { daily: { remaining: 2 } } })
    expect(yield* read()).toMatchObject({ generation: 'before', reads: 2 })
    const next = yield* deploy(makeStack('after'))
    expect(next.url).toBe(url)
    const recovered = yield* read().pipe(
      Effect.filterOrFail(
        Schema.is(Schema.Struct({ generation: Schema.Literal('after') })),
        () => new RestartPending(),
      ),
      Effect.retry({ times: 100, schedule: Schedule.spaced('100 millis') }),
    )
    expect(recovered).toMatchObject({
      generation: 'after',
      reads: 1,
      wallet: { daily: { remaining: 2 }, reservations: { 'recovery-operation': { amount: 8 } } },
      media: 'survives-native-restart',
    })
    yield* HttpClient.get(`${next.apiUrl}/api/health`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.filterOrFail(
        Schema.is(Schema.Struct({ release: Schema.Literal('native-after') })),
        () => new RestartPending(),
      ),
      Effect.retry({ times: 100, schedule: Schedule.spaced('100 millis') }),
    )
    // The health check built the restarted isolate's application without reading a session.
    yield* Effect.promise(() => verifyFirstSignedInTogether(styldUrl, cookie))
    expect((yield* HttpClient.post(`${url}/test/recovery/replay`)).status).toBe(204)
    expect(yield* read()).toMatchObject({ wallet: { daily: { remaining: 2 } } })
    expect((yield* HttpClient.post(`${url}/test/recovery/settle`)).status).toBe(204)
    expect(yield* read()).toMatchObject({ wallet: { daily: { remaining: 10 }, reservations: {} } })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 120000 },
)
