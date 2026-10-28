import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { Layer } from 'effect'
import { browserAuthLayer } from '@styld/auth/client'
import { Runtime } from 'foldkit'
import { Flags, Model, init, update } from './App.ts'
import { view } from './View.ts'
import { passwordFormLayer } from './PasswordForm.ts'
import { makeTelemetry } from './Telemetry.ts'

const telemetry = makeTelemetry(window.location.origin)

const application = Runtime.makeApplication(
  telemetry.instrument({
    Model,
    Flags,
    init,
    update,
    view,
    container: document.getElementById('root'),
    resources: Layer.mergeAll(
      FetchHttpClient.layer,
      browserAuthLayer(window.location.origin).pipe(Layer.orDie),
      passwordFormLayer(document),
    ),
  }),
)

Runtime.hydrate(application)
