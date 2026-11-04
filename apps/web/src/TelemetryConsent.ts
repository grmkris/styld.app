import { Context, Effect, Layer, Option, Predicate, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import type { Model } from './App.ts'
import { AppRoute } from './route.ts'

/** The visitor's choice about browser diagnostics; `undecided` is asked once a signed-in person has a piece (`asksOnceDressed`). */
export const TelemetryConsent = Schema.Literals(['undecided', 'granted', 'denied'])
export type TelemetryConsent = typeof TelemetryConsent.Type

/** Whether the prompt asks: a signed-in person who has not decided, outside sign-in, once their wardrobe holds a
 * piece. An empty wardrobe's first screen is the way to the first piece, and nothing covers it; so no page opens with
 * the prompt, and the server never draws it. A visitor opens it from the footer's Diagnostics. */
export const asksOnceDressed = (input: {
  readonly consent: TelemetryConsent
  readonly signedIn: boolean
  readonly route: AppRoute
  readonly pieceCount: number
}) =>
  input.consent === 'undecided' &&
  input.signedIn &&
  input.pieceCount > 0 &&
  !AppRoute.guards.Login(input.route) &&
  !AppRoute.guards.LoginForConnection(input.route)

/** The diagnostics prompt opens once the person's pieces arrive and there is one (`asksOnceDressed`). */
export const askOnceDressed = (model: Model): Model => {
  const pieceCount = Option.match(AsyncData.getData(model.data.pieces), {
    onNone: () => 0,
    onSome: (list) => list.length,
  })
  const asks = asksOnceDressed({
    consent: model.telemetry.consent,
    signedIn: Predicate.isTagged(model.session, 'SignedIn') || model.context.hasSessionCookie === true,
    route: model.route,
    pieceCount,
  })
  return asks && !model.telemetry.prompting
    ? modifyFields(model, { telemetry: (telemetry) => modifyFields(telemetry, { prompting: () => true }) })
    : model
}

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
