import { setConsent } from '@maple-dev/effect-sdk/client'
import { MapleFoldkit } from '@maple-dev/effect-sdk/foldkit'
import { Effect, Layer } from 'effect'
import { AppRoute, routeFromPathname } from './route.ts'
import { consentCookie, consentFromCookies, TelemetryConsentControl } from './TelemetryConsent.ts'

/** Each page's route as a template: no ids or handles, so a slow page is named without naming whose it was. */
const templateOf = AppRoute.match<string>({
  Home: () => '/',
  Login: () => '/login',
  LoginForConnection: () => '/login/connect',
  Account: () => '/account',
  Profile: () => '/profile',
  Wardrobe: () => '/wardrobe',
  AddPieces: () => '/wardrobe/add',
  Review: () => '/wardrobe/review',
  Piece: () => '/wardrobe/:piece',
  Looks: () => '/looks',
  Look: () => '/looks/:look',
  Ask: () => '/ask',
  Stylist: () => '/ask/stylist',
  Boards: () => '/boards',
  Board: () => '/boards/:board',
  BoardCollage: () => '/boards/:board/collage',
  Person: () => '/@:handle',
  PublicPiece: () => '/pieces/:piece',
  Explore: () => '/explore',
  NotFound: () => 'other',
})

/** Navigation spans carry the page's route template; the relay drops the raw `url.path` the SDK also records.
 * @internal Exported for its tests. */
export const routeName = (pathname: string): string => templateOf(routeFromPathname(pathname))

/** Every URL the SDK sends, in spans or its always-on session events, keeps only origin and route. The SDK also
 * passes a navigation's route name through here, a path such as `/boards/:board`, which names itself again.
 * @internal Exported for its tests. */
export const routeUrl = (url: string): string => {
  if (url.startsWith('/')) return routeName(new URL(url, 'https://styld.invalid').pathname)
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
