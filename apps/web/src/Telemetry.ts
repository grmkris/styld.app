import { setConsent } from '@maple-dev/effect-sdk/client'
import { MapleFoldkit } from '@maple-dev/effect-sdk/foldkit'
import { Effect, Layer } from 'effect'
import { consentCookie, consentFromCookies, TelemetryConsentControl } from './TelemetryConsent.ts'

const knownRoutes = new Set(['/', '/login', '/account'])

/** Navigation spans carry a fixed route name; the relay drops the raw `url.path` the SDK also records. */
const routeName = (pathname: string): string => (knownRoutes.has(pathname) ? pathname : 'other')

/** Every URL the SDK sends, in spans or its always-on session events, keeps only origin and route. */
const routeUrl = (url: string): string => {
  // URL.canParse (Safari 17) rather than URL.parse (Safari 18), for the Safari 17.5 baseline.
  if (!URL.canParse(url)) return 'other'
  const parsed = new URL(url)
  return `${parsed.origin}${routeName(parsed.pathname)}`
}

/** Browser telemetry as Effect spans: Foldkit Commands grouped under their page load or
 * navigation, crashes and slow phases. It posts OTLP/JSON to the same origin, where the
 * API Worker's relay keeps an allowlist and writes Workers Logs; no ingest key exists.
 * Nothing is captured until the visitor allows it. Session replay, session rows, Command
 * arguments, a visitor ID and browser storage are off; the SDK's session events post with
 * route-only URLs and no element text, and the relay discards them. */
const makeTelemetry = (origin: string) =>
  MapleFoldkit.make({
    serviceName: 'styld-web',
    serviceVersion: import.meta.env.VITE_STYLD_RELEASE ?? 'local-build',
    environment: import.meta.env.VITE_STYLD_ENV ?? 'local',
    endpoint: `${origin}/api/telemetry`,
    commandArgs: 'none',
    routeName,
    replay: { enabled: false, maskAllText: true },
    emitSessionMeta: false,
    privacy: {
      requireConsent: true,
      persistence: 'memory',
      persistVisitorId: false,
      captureUserEmail: false,
      respectDoNotTrack: true,
      sanitizeUrl: routeUrl,
    },
  })

/** Starts browser telemetry; a grant stored in the preference cookie applies before the first span. */
export const startTelemetry = (origin: string, cookies: string) => {
  const telemetry = makeTelemetry(origin)
  if (consentFromCookies(cookies) === 'granted') setConsent(true)
  return telemetry
}

/** Records the visitor's choice for this browser: the preference cookie and the SDK's consent. */
export const telemetryConsentLayer = (document: Document) =>
  Layer.succeed(TelemetryConsentControl, {
    record: (granted) =>
      Effect.sync(() => {
        document.cookie = consentCookie(granted, document.location.protocol === 'https:')
        setConsent(granted)
      }),
  })
