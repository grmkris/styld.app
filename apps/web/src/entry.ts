import '@fontsource-variable/hanken-grotesk/wght.css'
import * as BrowserCrypto from '@effect/platform-browser/BrowserCrypto'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { Layer } from 'effect'
import { browserAuthLayer } from '@styld/auth/client'
import { loadCatalog, normalizeLocale } from '@styld/i18n'
import { Runtime } from 'foldkit'
import { Flags, managedResources, Message, Model, init, subscriptions, update } from './App.ts'
import { view } from './View.ts'
import { emailSignInLayer } from './EmailSignIn.ts'
import { isTabChange, routing } from './Navigation.ts'
import { isLegal, routeFromPathname } from './route.ts'
import { styldClientLayer } from './StyldClient.ts'
import { consentFromCookies, telemetryConsentLayer } from './TelemetryConsent.ts'
import { pictureEncoderLayer } from './Upload.ts'

// Telemetry's code loads only for a visitor who allowed it; everyone else never downloads it. Only the page's language
// ships with it; another one loads when the person switches to it. The privacy policy's and the terms' words load only
// on those two pages, which every link reaches with a whole load (Navigation.ts).
const [telemetry] = await Promise.all([
  consentFromCookies(document.cookie) === 'granted'
    ? import('./Telemetry.ts').then(({ startTelemetry }) => startTelemetry(window.location.origin))
    : Promise.resolve(undefined),
  loadCatalog(normalizeLocale(document.documentElement.lang), {
    legal: isLegal(routeFromPathname(window.location.pathname)),
  }),
])

const config = {
  Model,
  Flags,
  init,
  update,
  view,
  subscriptions,
  managedResources,
  container: document.getElementById('root'),
  // Tab pages switch inside the page and cross-fade; every other link loads whole (Navigation.ts).
  routing,
  viewTransition: ({ previousModel, model }: Runtime.ViewTransitionContext<Model, Message>) =>
    isTabChange(previousModel.route, model.route),
  // The DevTools MCP may dispatch decoded Messages; the bridge only runs under Vite's dev server.
  devTools: { Message },
  resources: Layer.mergeAll(
    FetchHttpClient.layer,
    styldClientLayer(window.location.origin).pipe(Layer.provide(FetchHttpClient.layer)),
    emailSignInLayer(document).pipe(Layer.provideMerge(browserAuthLayer(window.location.origin)), Layer.orDie),
    telemetryConsentLayer({
      secure: document.location.protocol === 'https:',
      writeCookie: (cookie) => {
        document.cookie = cookie
      },
      applyConsent: (granted) => telemetry?.applyConsent(granted),
    }),
    pictureEncoderLayer,
  ).pipe(
    // @effect-diagnostics-next-line unstableApiUsage:off -- Effect's platform Web Crypto layer is the browser's only SecureRandom provider.
    Layer.provideMerge(BrowserCrypto.layerSecureRandom),
  ),
}

Runtime.hydrate(Runtime.makeApplication(telemetry === undefined ? config : telemetry.instrument(config)))
