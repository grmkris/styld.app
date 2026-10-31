import { expect } from 'bun:test'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import * as Test from 'alchemy/Test/Bun'
import { Effect, Redacted, Schedule, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { type Browser, chromium } from 'playwright'
import { verifyBrowser } from './BrowserAcceptance.ts'
import { pictureEnvironment, verifyCleanPictures } from './CleanPictureAcceptance.ts'
import { verifyTurn } from './TurnAcceptance.ts'
import { verifyCameraJourney, verifyCaptureJourney, verifyLongVideoJourney } from './CaptureBrowserAcceptance.ts'
import { verifyGalleryJourney } from './GalleryBrowserAcceptance.ts'
import { nativeDailyAllowance, verifyCaptures } from './CaptureAcceptance.ts'
import { verifyScan } from './ScanAcceptance.ts'
import { stylistEnvironment, verifyStylist } from './StylistAcceptance.ts'
import { verifyGallery } from './GalleryAcceptance.ts'
import { verifySocial } from './SocialAcceptance.ts'
import { verifyGeneration } from './GenerationAcceptance.ts'
import { verifyOutfits } from './OutfitAcceptance.ts'
import { verifyPhotos } from './PhotosAcceptance.ts'
import { verifyFirstSignedInTogether } from './SessionSetupAcceptance.ts'
import { verifyPublicJourney } from './SocialBrowserAcceptance.ts'
import { verifyBrowserIdentity } from './IdentityBrowserAcceptance.ts'
import { verifyMcp } from './McpAcceptance.ts'
import { verifyAccountDeletion, verifyWardrobe } from './WardrobeAcceptance.ts'
import RuntimeWorker from './RuntimeWorker.ts'
import StyldWorkerLive, { StyldWorker } from '../src/StyldWorker.ts'

const makeStack = (generation: string) =>
  Alchemy.Stack(
    'StyldLocalAcceptance',
    {
      providers: Cloudflare.providers(),
      state: Alchemy.localState(),
    },
    Effect.gen(function* () {
      const worker = yield* RuntimeWorker
      yield* worker.bind('AcceptanceGeneration', { env: { TEST_GENERATION: generation } })
      const styld = yield* StyldWorker
      // Execute the production SSR artifact in workerd. Website.Foldkit's dev
      // mode runs Vite in Node, which cannot prove the deployed Worker behavior.
      const website = yield* Cloudflare.Worker('NativeWebsite', {
        main: 'apps/web/dist/server/fetch.js',
        assets: { directory: 'apps/web/dist/client' },
        compatibility: { date: '2026-10-19' },
      })
      const edge = yield* Cloudflare.Worker('NativeEdge', {
        main: 'packages/server/src/EdgeWorker.ts',
        env: { API: styld, WEBSITE: website, ROBOTS: 'noindex' },
        assets: { directory: 'apps/web/dist/client' },
        compatibility: { date: '2026-10-19' },
      })
      // Native acceptance binds the same secret-text contract used by Alchemy's
      // preview stack. Values are test-only and never leave this process.
      yield* styld.bind('RuntimeConfiguration', {
        env: {
          AUTH_ORIGIN: edge.url,
          STYLD_ENV: 'local',
          STYLD_RELEASE: `native-${generation}`,
          // Capture providers stay off natively: each capture keeps its original photo as one detection.
          STYLD_PROVIDERS: 'off',
          // The stand-in judge decides checks: `[[fail]]` and `[[unsure]]` in public text.
          CHECKS: 'stand-in',
          // The stand-in painter and planner make stickers and mood boards: `[[refuse]]`, `[[lost]]` and `[[unclear]]` in
          // the words.
          GENERATED_PICTURES: 'stand-in',
          // Clef's stand-in ranks outfits and the rules stand in for Thinking's model: `[[unclear]]` in the words.
          OUTFITS: 'stand-in',
          ...pictureEnvironment(worker.url),
          ...stylistEnvironment(worker.url),
          DAILY_ALLOWANCE: String(nativeDailyAllowance),
          AUTH_SECRET: Redacted.make('native-test-auth-secret-012345678901234567890123'),
          AUTH_SESSION_KEYS: Redacted.make(
            JSON.stringify({
              activeKeyId: 'native-test',
              keys: [{ id: 'native-test', material: 'a'.repeat(43) }],
            }),
          ),
          AUTH_PROOF_KEYS: Redacted.make(
            JSON.stringify({ activeKeyId: 'native-test', keys: [{ id: 'native-test', material: 'd'.repeat(43) }] }),
          ),
          AUTH_REQUEST_BINDING_KEYS: Redacted.make(
            JSON.stringify({ activeKeyId: 'native-test', keys: [{ id: 'native-test', material: 'e'.repeat(43) }] }),
          ),
        },
      })
      return {
        url: worker.url.as<string>(),
        styldUrl: edge.url.as<string>(),
        apiUrl: styld.url.as<string>(),
        websiteUrl: website.url.as<string>(),
      }
    }).pipe(Effect.provide(StyldWorkerLive)),
  )

const Stack = makeStack('before')

class RestartPending extends Schema.TaggedError<RestartPending>()('RestartPending', {}) {}

const authCall =
  (origin: string) =>
  (action: string, payload: object, cookie = '') =>
    HttpClient.post(`${origin}/api/auth/${action}`, {
      headers: {
        origin: new URL(origin).origin,
        'content-type': 'application/json',
        'x-effect-auth-csrf': '1',
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

test(
  'serves MCP to OAuth clients: discovery, registration, consent, both protocol eras, rotation and revocation',
  overHttp(verifyMcp),
  { timeout: 120000 },
)

test(
  "keeps each account's pieces (upload checks, idempotent adds, queue processing, private images, edits, clean pictures, deletion) and deletes accounts",
  Effect.gen(function* () {
    const { url, styldUrl } = yield* stack
    yield* Effect.promise(() => verifyWardrobe(styldUrl, url).then(() => verifyCleanPictures(styldUrl, url)))
    yield* Effect.promise(() => verifyAccountDeletion(styldUrl, url))
  }),
  { timeout: 120000 },
)

// After the clean pictures above: the green shirt's taken drawing is what turns.
test(
  'turns a clean picture on its hanger: made on the queue, cut into frames here, checked, played on tap',
  inBrowser(verifyTurn),
  { timeout: 200000 },
)

test(
  "keeps each account's boards (idempotent creates, versioned saves, refused items, private pictures), worn days and website looks",
  overHttp(verifyGallery),
  { timeout: 60000 },
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
  'makes ranked outfits of the person’s own pieces, Fast and Thinking, never repeating one and keeping their pace and cap',
  overHttp(verifyOutfits),
  { timeout: 90000 },
)
test('shows a published profile and its public board to a signed-out visitor', inBrowser(verifyPublicJourney), {
  timeout: 60000,
})

test(
  'turns photos and videos into captures that wait for review, meters them daily, keeps them private, shows a ' +
    'garment seen across an import once, and lets Styld answer about the wardrobe',
  overHttp((origin, testUrl) =>
    verifyCaptures(origin, testUrl)
      .then(() => verifyScan(origin, testUrl))
      .then(() => verifyStylist(origin)),
  ),
  { timeout: 180000 },
)

test(
  'adds photos through the picker, keeps the ticked ones from the review tray and shows them in the wardrobe',
  inBrowser(verifyCaptureJourney),
  { timeout: 90000 },
)

test(
  'opens the camera over the whole page, takes a piece front then back, and pairs them in the tray',
  inBrowser(verifyCameraJourney),
  { timeout: 90000 },
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
        'x-effect-auth-csrf': '1',
      }),
      body: HttpBody.text('{}', 'application/json'),
    })
    expect(valid.status).toBe(200)
    expect(yield* valid.json).toMatchObject({ _tag: 'Success' })

    const wrongOrigin = yield* HttpClient.post(`${styldUrl}/api/auth/getSession`, {
      headers: new Headers({
        origin: 'https://evil.invalid',
        'content-type': 'application/json',
        'x-effect-auth-csrf': '1',
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
      reserved: { subscription: 2 },
      settled: { subscription: 10, purchased: 0, reservations: {} },
      other: { subscription: 0, purchased: 0, reservations: {} },
    })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves the isolated D1 schema and R2 binding',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/storage`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({
      database: {
        // Every table, in SQLite's name order.
        tables: (
          'accounts auth_attempt_buckets blocks board_images board_items board_pins boards capture_frames ' +
          'captures content_checks detections follows generation_jobs generation_pictures look_pieces looks ' +
          'oauth_assertions oauth_clients ' +
          'oauth_grants operation_receipts outfit_photos photo_garments piece_pictures piece_turns pieces profiles reports saves ' +
          'styld_auth_credentials styld_auth_email_credentials styld_auth_identifiers styld_auth_passwords ' +
          'styld_auth_pending styld_auth_proofs styld_auth_sessions thinking_days uploads worn_pieces'
        ).split(' '),
      },
      media: { sentinel: false },
    })
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
        'x-effect-auth-csrf': '1',
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
    const seeded = yield* HttpClient.post(`${url}/test/identity/seed`)
    expect(seeded.status).toBe(204)
    const call = authCall(styldUrl)
    // The typed API reads the same session: refused without one, the account with one.
    const me = (cookie?: string) =>
      HttpClient.get(`${styldUrl}/api/me`, cookie === undefined ? {} : { headers: new Headers({ cookie }) })
    expect((yield* me()).status).toBe(401)
    const credentials = { email: 'native-identity@example.invalid', password: 'native-identity-password-52' }
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
    expect(yield* account.json).toEqual({
      accountId: 'native-identity',
      displayName: 'Native Identity',
      email: 'native-identity@example.invalid',
    })
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
    const seeded = yield* HttpClient.post(`${url}/test/identity/seed-limited`)
    expect(seeded.status).toBe(204)
    const attempt = () =>
      HttpClient.post(`${styldUrl}/api/auth/signIn`, {
        headers: { origin: new URL(styldUrl).origin, 'content-type': 'application/json', 'x-effect-auth-csrf': '1' },
        body: HttpBody.text(
          JSON.stringify({
            payload: { email: 'native-limited@example.invalid', password: 'native-identity-password-52' },
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
      password: 'native-identity-password-52',
    })
    expect(yield* login.json).toMatchObject({ _tag: 'Success', value: { _tag: 'Authenticated' } })
    const cookie = Object.entries(login.cookies.cookies)
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const read = () => HttpClient.get(`${url}/test/recovery/read`).pipe(Effect.flatMap((response) => response.json))
    expect(yield* read()).toMatchObject({ generation: 'before', reads: 1, wallet: { subscription: 2 } })
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
      wallet: { subscription: 2, reservations: { 'recovery-operation': { fromSubscription: 8 } } },
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
    expect(yield* read()).toMatchObject({ wallet: { subscription: 2 } })
    expect((yield* HttpClient.post(`${url}/test/recovery/settle`)).status).toBe(204)
    expect(yield* read()).toMatchObject({ wallet: { subscription: 10, reservations: {} } })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 120000 },
)
