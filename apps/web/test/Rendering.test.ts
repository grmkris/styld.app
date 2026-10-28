import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { catalogVersion } from '@styld/i18n'
import * as Server from 'foldkit/experimental/server'
import { LocaleSave, Message, init, update, type Flags } from '../src/App.ts'
import { offeredLocales, requestLocale } from '../src/Locale.ts'
import { CircleNotchRegular } from '../src/PhosphorIcons.ts'
import { consentCookie, consentFromCookies, type TelemetryConsent } from '../src/TelemetryConsent.ts'
import { renderDocument, renderRequest } from '../src/entry.server.ts'

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
  }
})

test('negotiation respects explicit locale, cookie, language weights and exclusions', () => {
  expect(requestLocale(request('en;q=0,sl-SI;q=0.8'))).toBe('sl')
  expect(requestLocale(request('de,sl;q=0.9,en;q=0.5'))).toBe('sl')
  expect(requestLocale(request('sl;q=0,en;q=0.5'))).toBe('en')
  expect(requestLocale(new Request('https://styld.test/?lang=ar-XB', { headers: { cookie: 'styld_locale=sl' } }))).toBe(
    'ar-XB',
  )
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
  const initial = init({
    locale: 'en',
    catalogVersion,
    timeZone: 'UTC',
    referenceTime: 0,
    pathname: '/',
    telemetryConsent: 'granted',
  }).model
  const saving = update(initial, Message.SelectedLocale({ value: 'sl' }))
  expect(saving.commands?.[0]?.name).toBe('SaveLocale')
  expect(update(saving.model, Message.SelectedLocale({ value: 'en' })).commands).toBeUndefined()
  const failed = update(saving.model, Message.FailedSaveLocale()).model
  expect(failed.context.locale).toBe('en')
  expect(LocaleSave.guards.Failed(failed.localeSave)).toBe(true)
  expect(update(saving.model, Message.SucceededSaveLocale({ locale: 'sl' })).model.context.locale).toBe('sl')
})

test('RTL and expanded locales render without pretending to be Arabic translations', async () => {
  const rtl = await Effect.runPromise(renderRequest(new Request('https://styld.test/?lang=ar-XB'), { buildId: 'test' }))
  const html = await Server.toResponse((app) => renderDocument(app, assets), rtl).text()
  expect(html).toContain('dir="rtl"')
  expect(html).toContain('lang="ar-XB"')
  expect(html).toContain('English (RTL)')
  const missing = await Effect.runPromise(renderRequest(new Request('https://styld.test/missing'), { buildId: 'test' }))
  expect(Server.toResponse((app) => renderDocument(app, assets), missing).status).toBe(404)
})

test('only known test environments add the layout pseudo-locales', () => {
  expect(offeredLocales('production')).toEqual(['en', 'sl'])
  expect(offeredLocales('prodution')).toEqual(['en', 'sl'])
  expect(offeredLocales('preview')).toEqual(['en', 'sl', 'en-XA', 'ar-XB'])
  expect(offeredLocales('local')).toEqual(['en', 'sl', 'en-XA', 'ar-XB'])
})

const flags = (telemetryConsent: TelemetryConsent): Flags => ({
  locale: 'en',
  catalogVersion,
  timeZone: 'UTC',
  referenceTime: 0,
  pathname: '/',
  telemetryConsent,
})

test('asks for diagnostics consent until the visitor decides, and lets them reopen the choice', () => {
  const asking = init(flags('undecided')).model
  expect(asking.telemetry).toEqual({ consent: 'undecided', prompting: true })
  expect(init(flags('granted')).model.telemetry).toEqual({ consent: 'granted', prompting: false })
  const choosing = update(asking, Message.ChoseTelemetryConsent({ granted: false }))
  expect(choosing.model.telemetry.prompting).toBe(false)
  expect(choosing.commands?.[0]?.name).toBe('RecordTelemetryConsent')
  const declined = update(choosing.model, Message.RecordedTelemetryConsent({ granted: false })).model
  expect(declined.telemetry).toEqual({ consent: 'denied', prompting: false })
  const reopened = update(declined, Message.OpenedTelemetrySettings()).model
  expect(reopened.telemetry).toEqual({ consent: 'denied', prompting: true })
  expect(update(reopened, Message.RecordedTelemetryConsent({ granted: true })).model.telemetry.consent).toBe('granted')
})

test('reads only a recorded diagnostics choice from cookies', () => {
  expect(consentFromCookies(undefined)).toBe('undecided')
  expect(consentFromCookies('a=b; styld_diagnostics=granted')).toBe('granted')
  expect(consentFromCookies('styld_diagnostics=denied')).toBe('denied')
  expect(consentFromCookies('styld_diagnostics=yes; styld_diagnosticsx=granted')).toBe('undecided')
  expect(consentCookie(true, true)).toBe('styld_diagnostics=granted; Path=/; Max-Age=15552000; SameSite=Lax; Secure')
})

const renderPage = async (path: string, cookie?: string) => {
  const result = await Effect.runPromise(
    renderRequest(new Request(`https://styld.test${path}`, cookie === undefined ? {} : { headers: { cookie } }), {
      buildId: 'test',
    }),
  )
  return Server.toResponse((app) => renderDocument(app, assets), result).text()
}

test('server rendering shows the consent prompt only to undecided visitors', async () => {
  const prompt = 'record anonymous error and speed data'
  expect(await renderPage('/')).toContain(prompt)
  expect(await renderPage('/', 'styld_diagnostics=granted')).not.toContain(prompt)
  expect(await renderPage('/', 'styld_diagnostics=denied')).not.toContain(prompt)
})

test('server rendering draws the session check loader as an inline, hidden Phosphor icon', async () => {
  const html = await renderPage('/login')
  const status = /<p role="status"[^>]*>(<svg[^>]*>)<path d="([^"]+)"/.exec(html)
  expect(status?.[1]).toContain('viewBox="0 0 256 256"')
  expect(status?.[1]).toContain('aria-hidden="true"')
  expect(status?.[1]).toContain('data-loader')
  expect(status?.[2]).toBe(CircleNotchRegular)
})
