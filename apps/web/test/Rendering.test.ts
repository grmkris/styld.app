import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { catalogVersion } from '@styld/i18n'
import * as Server from 'foldkit/experimental/server'
import { LocaleSave, Message, init, update, type Flags } from '../src/App.ts'
import { parseLocale, requestLocale } from '../src/Locale.ts'
import { CircleNotchRegular } from '../src/PhosphorIcons.ts'
import {
  consentFromCookies,
  type TelemetryConsent,
  TelemetryConsentControl,
  telemetryConsentLayer,
} from '../src/TelemetryConsent.ts'
import { SessionHttp } from '@styld/auth/config'
import { application, renderDocument, renderRequest } from '../src/entry.server.ts'
import { urlOf } from './AppFixtures.ts'
import { pieceFixture } from './WardrobeFixtures.ts'
import * as ServerData from '../src/ServerData.ts'

const assets = { entryScript: '/entry.js', stylesheets: [], modulePreloads: [] }
const request = (language: string) => new Request('https://styld.test/', { headers: { 'accept-language': language } })
const saveLocale = (origin: string, body = 'locale=sl') =>
  Effect.runPromise(
    renderRequest(
      new Request('https://styld.test/locale', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
    ),
  )

test('concurrent server renders isolate locales and carry the exact catalog into hydration', async () => {
  const results = await Effect.runPromise(
    Effect.all(
      ['en', 'sl', 'en', 'sl'].map((locale) => renderRequest(request(locale), { buildId: 'test-release' })),
      { concurrency: 'unbounded' },
    ),
  )
  for (const [index, result] of results.entries()) {
    const response = Server.toResponse((app) => renderDocument(app, assets), result)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain(index % 2 === 0 ? 'A wardrobe shaped by you.' : 'Garderoba po tvojem okusu.')
    expect(html).toContain(catalogVersion)
    expect(html).toContain('test-release')
    expect(html).toContain('viewport-fit=cover')
    // Light and dark: the site offers its own dark, so a dark-mode phone's browser does not force one (T-18), and the
    // browser's bars take the paper of either scheme.
    expect(html).toContain('<meta name="color-scheme" content="light dark">')
    expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f1eee7">')
    expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#17120f">')
  }
})

test('negotiation respects explicit locale, cookie, language weights and exclusions', () => {
  expect(requestLocale(request('en;q=0,sl-SI;q=0.8'))).toBe('sl')
  expect(requestLocale(request('de,sl;q=0.9,en;q=0.5'))).toBe('sl')
  expect(requestLocale(request('sl;q=0,en;q=0.5'))).toBe('en')
  expect(requestLocale(new Request('https://styld.test/?lang=sl', { headers: { cookie: 'styld_locale=en' } }))).toBe(
    'sl',
  )
  // A pseudo-locale is never chosen through a request: neither the address nor the cookie selects one.
  expect(requestLocale(new Request('https://styld.test/?lang=ar-XB', { headers: { cookie: 'styld_locale=sl' } }))).toBe(
    'sl',
  )
  expect(requestLocale(new Request('https://styld.test/', { headers: { cookie: 'styld_locale=en-XA' } }))).toBe('en')
  expect(
    requestLocale(
      new Request('https://styld.test/', { headers: { cookie: 'styld_locale=sl', 'accept-language': 'en' } }),
    ),
  ).toBe('sl')
})

test('language preference writes require same-origin POST and produce protected cookies', async () => {
  const result = await saveLocale('https://styld.test')
  const response = Server.toResponse((app) => renderDocument(app, assets), result)
  expect(response.status).toBe(204)
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax; Secure')
  expect(Server.toResponse((app) => renderDocument(app, assets), await saveLocale('https://evil.test')).status).toBe(
    403,
  )
  expect(
    Server.toResponse((app) => renderDocument(app, assets), await saveLocale('https://styld.test', 'locale=bad'))
      .status,
  ).toBe(400)
})

test('language changes serialize persistence and keep failure visible', () => {
  const initial = init(
    {
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: 0,
      origin: 'https://styld.test',
      telemetryConsent: 'granted',
    },
    urlOf('/'),
  ).model
  const saving = update(initial, Message.SelectedLocale({ value: 'sl' }))
  expect(saving.commands?.[0]?.name).toBe('SaveLocale')
  expect(update(saving.model, Message.SelectedLocale({ value: 'en' })).commands).toBeUndefined()
  const failed = update(saving.model, Message.FailedSaveLocale()).model
  expect(failed.context.locale).toBe('en')
  expect(LocaleSave.guards.Failed(failed.localeSave)).toBe(true)
  expect(update(saving.model, Message.SucceededSaveLocale({ locale: 'sl' })).model.context.locale).toBe('sl')
})

test('the RTL pseudo-locale, opened through code, renders without pretending to be an Arabic translation', async () => {
  const rtl = await Effect.runPromise(
    Server.renderToString(application, {
      buildId: 'test',
      url: 'https://styld.test/',
      flags: { ...flags('denied'), locale: 'ar-XB' },
    }),
  )
  const html = renderDocument(rtl, assets)
  expect(html).toContain('dir="rtl"')
  expect(html).toContain('lang="ar-XB"')
  const missing = await Effect.runPromise(renderRequest(new Request('https://styld.test/missing'), { buildId: 'test' }))
  expect(Server.toResponse((app) => renderDocument(app, assets), missing).status).toBe(404)
})

test('the language menu offers the reviewed languages only, never a testing pseudo-locale', async () => {
  const page = await Effect.runPromise(renderRequest(request('en'), { buildId: 'test' }))
  const html = await Server.toResponse((app) => renderDocument(app, assets), page).text()
  expect(html).toContain('Slovenščina')
  expect(html).not.toContain('English (expanded)')
  expect(html).not.toContain('English (RTL)')
  expect(['en', 'sl', 'en-XA', 'ar-XB', 'de'].map(parseLocale)).toEqual(['en', 'sl', undefined, undefined, undefined])
})

const flags = (telemetryConsent: TelemetryConsent): Flags => ({
  locale: 'en',
  catalogVersion,
  timeZone: 'UTC',
  referenceTime: 0,

  origin: 'https://styld.test',
  telemetryConsent,
})

const piecesArrive = (model: ReturnType<typeof init>['model'], count: number) =>
  update(
    model,
    Message.GotServerDataMessage({
      message: ServerData.Message.SucceededListPieces({
        pieces: Array.from({ length: count }, (_, index) => pieceFixture(`p${index}`)),
      }),
    }),
  ).model

test('asks a signed-in person for diagnostics consent once they have a piece, until they decide, and lets anyone reopen the choice', () => {
  const signedIn = (telemetryConsent: TelemetryConsent): Flags => ({
    ...flags(telemetryConsent),
    hasSessionCookie: true,
  })
  // No page opens with the prompt: an empty wardrobe's first screen is the way to the first piece.
  const opening = init(signedIn('undecided'), urlOf('/')).model
  expect(opening.telemetry).toEqual({ consent: 'undecided', prompting: false })
  expect(piecesArrive(opening, 0).telemetry.prompting).toBe(false)
  const asking = piecesArrive(opening, 1)
  expect(asking.telemetry).toEqual({ consent: 'undecided', prompting: true })
  expect(piecesArrive(init(signedIn('granted'), urlOf('/')).model, 1).telemetry.prompting).toBe(false)
  // A visitor who is not signed in, and sign-in itself, are not interrupted; the footer still opens the choice.
  const visitor = init(flags('undecided'), urlOf('/')).model
  expect(piecesArrive(visitor, 1).telemetry.prompting).toBe(false)
  expect(update(visitor, Message.OpenedTelemetrySettings()).model.telemetry.prompting).toBe(true)
  expect(piecesArrive(init(signedIn('undecided'), urlOf('/login')).model, 1).telemetry.prompting).toBe(false)
  expect(piecesArrive(init(signedIn('undecided'), urlOf('/login/connect')).model, 1).telemetry.prompting).toBe(false)
  const choosing = update(asking, Message.ChoseTelemetryConsent({ granted: false }))
  expect(choosing.model.telemetry.prompting).toBe(false)
  expect(choosing.commands?.[0]?.name).toBe('RecordTelemetryConsent')
  const declined = update(choosing.model, Message.RecordedTelemetryConsent({ granted: false })).model
  expect(declined.telemetry).toEqual({ consent: 'denied', prompting: false })
  expect(piecesArrive(declined, 2).telemetry.prompting).toBe(false)
  const reopened = update(declined, Message.OpenedTelemetrySettings()).model
  expect(reopened.telemetry).toEqual({ consent: 'denied', prompting: true })
  expect(update(reopened, Message.RecordedTelemetryConsent({ granted: true })).model.telemetry.consent).toBe('granted')
})

test('reads only a recorded diagnostics choice from cookies', () => {
  expect(consentFromCookies(undefined)).toBe('undecided')
  expect(consentFromCookies('a=b; styld_diagnostics=granted')).toBe('granted')
  expect(consentFromCookies('styld_diagnostics=denied')).toBe('denied')
  expect(consentFromCookies('styld_diagnostics=yes; styld_diagnosticsx=granted')).toBe('undecided')
})

test('a choice is kept in the preference cookie and handed to telemetry running on the page', () => {
  const written: Array<string> = []
  const applied: Array<boolean> = []
  const browser = telemetryConsentLayer({
    secure: true,
    writeCookie: (cookie) => written.push(cookie),
    applyConsent: (granted) => applied.push(granted),
  })
  Effect.runSync(TelemetryConsentControl.use((control) => control.record(true)).pipe(Effect.provide(browser)))
  expect(written).toEqual(['styld_diagnostics=granted; Path=/; Max-Age=15552000; SameSite=Lax; Secure'])
  expect(consentFromCookies(written[0])).toBe('granted')
  expect(applied).toEqual([true])
})

const renderPage = async (path: string, cookie?: string) => {
  const result = await Effect.runPromise(
    renderRequest(new Request(`https://styld.test${path}`, cookie === undefined ? {} : { headers: { cookie } }), {
      buildId: 'test',
    }),
  )
  return Server.toResponse((app) => renderDocument(app, assets), result).text()
}

const sessionCookie = `${SessionHttp.cookieName}=test`

test('the server never draws the consent prompt: it opens once a signed-in person’s pieces arrive', async () => {
  const prompt = 'record anonymous error and speed data'
  expect(await renderPage('/', sessionCookie)).not.toContain(prompt)
  expect(await renderPage('/')).not.toContain(prompt)
  expect(await renderPage('/login', sessionCookie)).not.toContain(prompt)
})

test('server rendering draws the table’s loader as an inline, hidden Phosphor icon', async () => {
  const html = await renderPage('/', sessionCookie)
  const status = /<div role="status"[^>]*>(<svg[^>]*>)<path d="([^"]+)"/.exec(html)
  expect(status?.[1]).toContain('viewBox="0 0 256 256"')
  expect(status?.[1]).toContain('aria-hidden="true"')
  expect(status?.[1]).toContain('data-loader')
  expect(status?.[2]).toBe(CircleNotchRegular)
})

test('with a session cookie, the server draws the navigation and today’s table in their final shape', async () => {
  const html = await renderPage('/', sessionCookie)
  expect(html).toContain('aria-label="Navigation"')
  expect(html).toContain('data-skeleton')
  expect(html).toContain('id="today-headline"')
  expect(html).not.toContain('A wardrobe shaped by you.')
})

test('tab pages carry no inline style, which the page’s CSP would refuse', async () => {
  for (const path of ['/', '/wardrobe', '/looks', '/boards', '/ask', '/account'])
    expect({ path, inline: (await renderPage(path, sessionCookie)).includes(' style="') }).toEqual({
      path,
      inline: false,
    })
})

test('a board, look, piece or profile page ships no site-wide preview, so a private one cannot claim it is public', async () => {
  for (const path of ['/@nika.kovac', '/boards/bd_abc', '/looks/lk_abc', '/pieces/pc_abc']) {
    const html = await renderPage(path)
    expect({ path, og: html.includes('og:title'), card: html.includes('twitter:card') }).toEqual({
      path,
      og: false,
      card: false,
    })
  }
  const home = await renderPage('/')
  expect(home).toContain('property="og:title"')
  expect(home).toContain('name="twitter:card"')
  expect(await renderPage('/boards')).toContain('property="og:title"')
})

const facePreloads = (html: string) =>
  [
    ...html.matchAll(/<link rel="preload" href="[^"]*\/([a-z-]+)[^"/]*" as="font" type="font\/woff2" crossorigin>/g),
  ].map((match) => match[1])

test('the document asks for its face up front: Latin always, the Slovenian letters only for Slovenian', async () => {
  expect(facePreloads(await renderPage('/', 'styld_locale=en'))).toEqual(['hanken-grotesk-latin-wght-normal'])
  expect(facePreloads(await renderPage('/', 'styld_locale=sl'))).toEqual([
    'hanken-grotesk-latin-wght-normal',
    'hanken-grotesk-latin-ext-wght-normal',
  ])
})

const statusOf = async (path: string) =>
  Server.toResponse(
    (app) => renderDocument(app, assets),
    await Effect.runPromise(renderRequest(new Request(`https://styld.test${path}`), { buildId: 'test' })),
  ).status

test('every page answers 200 and paths beside them answer 404', async () => {
  for (const path of [
    '/',
    '/login',
    '/login/connect',
    '/account',
    '/wardrobe',
    '/wardrobe/add',
    '/wardrobe/review',
    '/wardrobe/pc_abc',
    // Explore's former address opens Home (owner, 4 November).
    '/explore',
  ])
    expect(await statusOf(path)).toBe(200)
  for (const path of ['/login/elsewhere', '/account/settings', '/connect', '/wardrobe/add/more'])
    expect(await statusOf(path)).toBe(404)
})

test('an old or broken wardrobe link renders the wardrobe without the part that is not ours, never Not found', async () => {
  for (const path of ['/wardrobe?group=nonsense', '/wardrobe?group=shoes&type=flats&rainproof=no&colours=teal']) {
    const html = await renderPage(path, sessionCookie)
    expect({ path, loading: html.includes('Loading pieces…'), notFound: html.includes('Page not found') }).toEqual({
      path,
      loading: true,
      notFound: false,
    })
  }
})
