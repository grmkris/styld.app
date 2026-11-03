import hankenLatin from '@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2?url'
import hankenLatinExt from '@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-ext-wght-normal.woff2?url'
import { provideAllCatalogs } from '@styld/i18n/all'
import { Clock, Effect } from 'effect'
import { layer as cloudflareTracer } from '@alchemy.run/cloudflare/Workers/CloudflareTracer'
import * as Server from 'foldkit/experimental/server'
import { SessionHttp } from '@styld/auth/config'
import { catalogVersion } from '@styld/i18n'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@styld/observability'
import { Flags, init } from './App.ts'
import { localeEndpoint, requestLocale } from './Locale.ts'
import { AppRoute, routeFromPathname } from './route.ts'
import { consentFromCookies } from './TelemetryConsent.ts'
import { view } from './View.ts'
import { saveLocale } from './server/LocalePreference.ts'

// The server formats in every language: page renders and code emails.
provideAllCatalogs()

export const application = { Flags, routing: {}, init, view }

const renderApplication = (
  request: Request,
  options: { readonly buildId?: string; readonly runtimeId?: string } = {},
) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    if (url.pathname === localeEndpoint) return yield* saveLocale(request)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Server.Responded(new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } }))
    }
    const flags: Flags = {
      locale: requestLocale(request),
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: yield* Clock.currentTimeMillis,
      origin: url.origin,
      telemetryConsent: consentFromCookies(request.headers.get('cookie')),
      hasSessionCookie: (request.headers.get('cookie') ?? '').includes(`${SessionHttp.cookieName}=`),
    }
    const rendered = yield* Server.renderToString(application, { ...options, url: request.url, flags })
    return Server.Rendered(rendered, {
      status: AppRoute.guards.NotFound(routeFromPathname(url.pathname)) ? 404 : 200,
      headers: {
        'cache-control': 'private, no-store',
        vary: 'Accept-Language, Cookie',
        'content-language': flags.locale,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    })
  })

export const renderRequest = (
  request: Request,
  options: { readonly buildId?: string; readonly runtimeId?: string } = {},
) =>
  Effect.gen(function* () {
    const identity = yield* makeObservabilityBase({
      environment: import.meta.env.VITE_STYLD_ENV ?? 'local',
      release: import.meta.env.VITE_STYLD_RELEASE ?? 'local-build',
      component: 'web',
    }).pipe(Effect.orDie)
    return yield* renderApplication(request, options).pipe(
      withObservability('styld.web.render', metadataFromHeaders(identity, request.headers)),
    )
  })

export const renderPage: Server.EntryModule['renderPage'] = (request) =>
  Effect.runPromise(renderRequest(request).pipe(Effect.provide(cloudflareTracer)))

/** The face is asked for with the document rather than after its stylesheet, so text rarely draws in the fallback.
 * Slovenian draws č, š and ž from the latin-ext file. Vite names both after their content, as the client's do. */
const facePreloads = (lang: string | undefined) =>
  [hankenLatin, ...(lang === 'sl' ? [hankenLatinExt] : [])]
    .map((href) => `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`)
    .join('')

/** Light and dark (`GlobalStyles.ts` `:root`): the meta lets the browser know before any style loads, so it never
 * forces its own dark, and the browser's bars take the paper of the scheme in use (zyzz.config.ts `paper`). */
const documentHead =
  '<meta name="color-scheme" content="light dark">' +
  '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f1eee7">' +
  '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#17120f">' +
  '<link rel="icon" href="/favicon.svg">'

export const renderDocument: Server.DocumentRenderer = (renderedApplication, assets) =>
  Server.renderDocument(renderedApplication, assets, {
    head: [documentHead, facePreloads(renderedApplication.lang)].join(''),
  }).replace(
    'content="width=device-width, initial-scale=1.0"',
    'content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"',
  )
