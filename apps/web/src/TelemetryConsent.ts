import { Context, Effect, Layer, Schema } from 'effect'
import { AppRoute } from './route.ts'

/** The visitor's choice about browser diagnostics; `undecided` is asked once signed in (`asksAtStart`). */
export const TelemetryConsent = Schema.Literals(['undecided', 'granted', 'denied'])
export type TelemetryConsent = typeof TelemetryConsent.Type

/** Whether a page opens with the prompt: for a signed-in person who has not decided, outside sign-in itself. A visitor
 * opens it from the footer's Diagnostics. The server renders from the same flags, so both agree on whether it shows. */
export const asksAtStart = (
  flags: { readonly telemetryConsent: TelemetryConsent; readonly hasSessionCookie?: boolean },
  route: AppRoute,
) =>
  flags.telemetryConsent === 'undecided' &&
  flags.hasSessionCookie === true &&
  !AppRoute.guards.Login(route) &&
  !AppRoute.guards.LoginForConnection(route)

const cookieName = 'styld_diagnostics'

/** The choice in a `Cookie` header or `document.cookie`; any other value is undecided. */
export const consentFromCookies = (cookies: string | null | undefined): TelemetryConsent => {
  const value = cookies
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1)
  return value === 'granted' || value === 'denied' ? value : 'undecided'
}

/** A first-party preference cookie that page code can read: the browser entry loads telemetry only when it holds a
 * grant, and server rendering hides a decided prompt. */
const consentCookie = (granted: boolean, secure: boolean): string =>
  `${cookieName}=${granted ? 'granted' : 'denied'}; Path=/; Max-Age=15552000; SameSite=Lax${secure ? '; Secure' : ''}`

/** Records a choice in the browser: the preference cookie, and the telemetry SDK's consent where it runs. */
export class TelemetryConsentControl extends Context.Service<
  TelemetryConsentControl,
  { readonly record: (granted: boolean) => Effect.Effect<void> }
>()('@styld/web/TelemetryConsentControl') {}

/** The browser's consent control: it writes the preference cookie and hands the choice to telemetry running on this
 * page (`applyConsent`), so a withdrawal stops it at once and a grant starts it from the next page load. */
export const telemetryConsentLayer = (browser: {
  readonly secure: boolean
  readonly writeCookie: (cookie: string) => void
  readonly applyConsent: (granted: boolean) => void
}) =>
  Layer.succeed(TelemetryConsentControl, {
    record: (granted) =>
      Effect.sync(() => {
        browser.writeCookie(consentCookie(granted, browser.secure))
        browser.applyConsent(granted)
      }),
  })
