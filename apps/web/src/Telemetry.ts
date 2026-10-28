import { MapleFoldkit } from '@maple-dev/effect-sdk/foldkit'

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
 * Session replay, session rows, Command arguments, a visitor ID and browser storage are off;
 * the SDK's session events still post, with route-only URLs and no element text, and the relay
 * discards them. */
export const makeTelemetry = (origin: string) =>
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
      persistence: 'memory',
      persistVisitorId: false,
      captureUserEmail: false,
      respectDoNotTrack: true,
      sanitizeUrl: routeUrl,
    },
  })
