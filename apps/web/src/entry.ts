import '@fontsource-variable/hanken-grotesk/wght.css'
import * as BrowserCrypto from '@effect/platform-browser/BrowserCrypto'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { Layer } from 'effect'
import { browserAuthLayer } from '@styld/auth/client'
import { loadCatalog, normalizeLocale } from '@styld/i18n'
import { Runtime } from 'foldkit'
import { Flags, Message, Model, init, subscriptions, update } from './App.ts'
import { view } from './View.ts'
import { emailSignInLayer } from './EmailSignIn.ts'
import { isTabChange, routing } from './Navigation.ts'
import { styldClientLayer } from './StyldClient.ts'
import { startTelemetry, telemetryConsentLayer } from './Telemetry.ts'
import { pictureEncoderLayer } from './Upload.ts'

const telemetry = startTelemetry(window.location.origin, document.cookie)

// Only the page's language ships with it; another one loads when the person switches to it.
await loadCatalog(normalizeLocale(document.documentElement.lang))

const application = Runtime.makeApplication(
  telemetry.instrument({
    Model,
    Flags,
    init,
    update,
    view,
    subscriptions,
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
      telemetryConsentLayer(document),
      pictureEncoderLayer,
    ).pipe(
      // @effect-diagnostics-next-line unstableApiUsage:off -- Effect's platform Web Crypto layer is the browser's only Crypto provider.
      Layer.provideMerge(BrowserCrypto.layer),
    ),
  }),
)

Runtime.hydrate(application)
