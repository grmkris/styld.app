import { Context, type Effect, Schema } from 'effect'

/** The visitor's choice about browser diagnostics; `undecided` shows the prompt. */
export const TelemetryConsent = Schema.Literals(['undecided', 'granted', 'denied'])
export type TelemetryConsent = typeof TelemetryConsent.Type

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

/** A first-party preference cookie that page code can read: the browser entry applies a
 * stored grant before the first span, and server rendering hides a decided prompt. */
export const consentCookie = (granted: boolean, secure: boolean): string =>
  `${cookieName}=${granted ? 'granted' : 'denied'}; Path=/; Max-Age=15552000; SameSite=Lax${secure ? '; Secure' : ''}`

/** Records a choice in the browser: the preference cookie and the telemetry SDK's consent. */
export class TelemetryConsentControl extends Context.Service<
  TelemetryConsentControl,
  { readonly record: (granted: boolean) => Effect.Effect<void> }
>()('@styld/web/TelemetryConsentControl') {}
