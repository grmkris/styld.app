import { MapleFoldkit } from '@maple-dev/effect-sdk/foldkit'

const knownRoutes = new Set(['/', '/login', '/account'])

/** Navigation spans carry a fixed route name, never a raw path that could hold personal data. */
const routeName = (pathname: string): string => (knownRoutes.has(pathname) ? pathname : 'other')

/** Browser telemetry as Effect spans: Foldkit Commands grouped under their page load or
 * navigation, crashes and slow phases. It posts OTLP/JSON to the same origin, where the
 * API Worker's relay keeps an allowlist and writes Workers Logs; no ingest key exists.
 * Session replay, session rows, Command arguments, a visitor ID and browser storage are off. */
export const makeTelemetry = (origin: string) =>
  MapleFoldkit.make({
    serviceName: 'styld-web',
    serviceVersion: import.meta.env.VITE_STYLD_RELEASE ?? 'local-build',
    environment: import.meta.env.VITE_STYLD_ENV ?? 'local',
    endpoint: `${origin}/api/telemetry`,
    commandArgs: 'none',
    routeName,
    replay: { enabled: false },
    emitSessionMeta: false,
    privacy: { persistence: 'memory', persistVisitorId: false, captureUserEmail: false, respectDoNotTrack: true },
  })
