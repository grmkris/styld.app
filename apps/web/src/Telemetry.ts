import { setConsent } from '@maple-dev/effect-sdk/client'
import { MapleFoldkit } from '@maple-dev/effect-sdk/foldkit'
import { routeFromPathname, routeMeta } from './route.ts'

// Browser telemetry, loaded only for a visitor whose preference cookie allows it (entry.ts imports this module on
// demand, so a page without consent never downloads the SDK). The SDK instruments the application before it starts
// and cannot join a running one, so a grant given on a page applies from the next page load.

/** Navigation spans carry the page's route template; the relay drops the raw `url.path` the SDK also records.
 */
export const routeName = (pathname: string): string => routeMeta(routeFromPathname(pathname)).template

/** Every URL the SDK sends, in spans or its always-on session events, keeps only origin and route. The SDK also
 * passes a navigation's route name through here, a path such as `/boards/:board`, which names itself again.
 */
export const routeUrl = (url: string): string => {
  if (url.startsWith('/')) return routeName(new URL(url, 'https://styld.invalid').pathname)
  // URL.canParse (Safari 17) rather than URL.parse (Safari 18), for the Safari 17.5 baseline.
  if (!URL.canParse(url)) return 'other'
  const parsed = new URL(url)
  return `${parsed.origin}${routeName(parsed.pathname)}`
}

/** Browser telemetry as Effect spans: Foldkit Commands grouped under their page load or navigation, crashes and slow
 * phases. It posts OTLP/JSON to the same origin, where the API Worker's relay keeps an allowlist and writes Workers
 * Logs; no ingest key exists. Session replay, session rows, Command arguments, a visitor ID and browser storage are
 * off; the SDK's session events post with route-only URLs and no element text, and the relay discards them. The SDK's
 * own consent gate stays on, so withdrawing the grant on this page stops it at once. */
export const startTelemetry = (origin: string) => {
  const telemetry = MapleFoldkit.make({
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
  setConsent(true)
  return { instrument: telemetry.instrument, applyConsent: setConsent }
}
