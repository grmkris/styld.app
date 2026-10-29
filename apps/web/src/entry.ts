import '@fontsource-variable/hanken-grotesk/wght.css'
import * as BrowserCrypto from '@effect/platform-browser/BrowserCrypto'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { Layer } from 'effect'
import { browserAuthLayer } from '@styld/auth/client'
import { Runtime } from 'foldkit'
import { Flags, Message, Model, init, update } from './App.ts'
import { view } from './View.ts'
import { emailSignInLayer } from './EmailSignIn.ts'
import { startTelemetry, telemetryConsentLayer } from './Telemetry.ts'

const telemetry = startTelemetry(window.location.origin, document.cookie)

const application = Runtime.makeApplication(
  telemetry.instrument({
    Model,
    Flags,
    init,
    update,
    view,
    container: document.getElementById('root'),
    // The DevTools MCP may dispatch decoded Messages; the bridge only runs under Vite's dev server.
    devTools: { Message },
    resources: Layer.mergeAll(
      FetchHttpClient.layer,
      emailSignInLayer(document).pipe(
        Layer.provideMerge(browserAuthLayer(window.location.origin)),
        // @effect-diagnostics-next-line unstableApiUsage:off -- Effect's platform Web Crypto layer is the browser's only Crypto provider.
        Layer.provide(BrowserCrypto.layer),
        Layer.orDie,
      ),
      telemetryConsentLayer(document),
    ),
  }),
)

Runtime.hydrate(application)
