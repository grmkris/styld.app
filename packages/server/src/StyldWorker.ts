import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { Effect, Layer, Logger } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import { decodeAuthSecret, decodeAuthSessionKeyring } from './AuthConfiguration.ts'
import { browserTelemetryRoutes } from './BrowserTelemetry.ts'
import { apiRoutes } from './Api.ts'
import { makeAuthHttp } from './AuthHttp.ts'
import { DomainLive } from './DomainLive.ts'
import { health } from './Health.ts'
import { onFirstUse } from './IsolateCache.ts'
import { StyldDatabase } from './Resources.ts'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@styld/observability'

const Runtime = Layer.mergeAll(
  DomainLive,
  Cloudflare.Telemetry({ headSamplingRate: 1 }),
  Cloudflare.D1.QueryDatabaseBinding,
  Cloudflare.Workers.RateLimitBinding,
)

// Alchemy's Worker bridge gives every event `Logger.consolePretty`, which reaches Workers Logs
// as one string. Requests log structured objects instead, so Workers Logs indexes every field.
const structuredLogs: ReadonlySet<Logger.Logger<unknown, unknown>> = new Set([Logger.consoleStructured])

export class StyldWorker extends Cloudflare.Worker<StyldWorker, Cloudflare.WorkerShape>()('StyldWorker') {}

export default StyldWorker.make(
  {
    main: import.meta.url,
    // Keep local workerd and deployed Workers on the same supported date; telemetry needs >= 2026-07-28.
    compatibility: { date: '2026-10-19' },
    workersDev: { enabled: false, previewsEnabled: false },
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: true } },
  },
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(StyldDatabase)
    // The browser telemetry relay is unauthenticated; each client IP may post 120 times a
    // minute (the SDK flushes about twice every 5 seconds per tab).
    const telemetryLimit = yield* Cloudflare.Workers.RateLimit('TELEMETRY_RATE_LIMIT', {
      namespaceId: 2610281,
      simple: { limit: 120, period: 60 },
    })
    // Telemetry is never worth an outage or an open door: a limiter error refuses the post.
    const allowTelemetry = (client: string) =>
      telemetryLimit.limit({ key: client }).pipe(
        Effect.map(({ success }) => success),
        Effect.orElseSucceed(() => false),
      )
    // Bindings configured by the stack (including the web origin and secrets)
    // exist only in the deployed request runtime, not while Alchemy evaluates
    // the Worker declaration during planning. Build the application on the
    // first request and reuse it for every later request in this isolate.
    const application = yield* onFirstUse((env: Cloudflare.Workers.WorkerEnvironment['Service']) =>
      Effect.gen(function* () {
        const observabilityBase = yield* makeObservabilityBase({
          environment: env.STYLD_ENV,
          release: env.STYLD_RELEASE,
          component: 'server',
        }).pipe(Effect.orDie)
        const authOrigin: unknown = env.AUTH_ORIGIN
        if (typeof authOrigin !== 'string' || authOrigin.length === 0) {
          return yield* Effect.die(new Error('AUTH_ORIGIN binding is required'))
        }
        const authSessionKeys = yield* decodeAuthSessionKeyring(env.AUTH_SESSION_KEYS).pipe(Effect.orDie)
        const authSecret = yield* decodeAuthSecret(env.AUTH_SECRET).pipe(Effect.orDie)
        const auth = makeAuthHttp(database, {
          origin: authOrigin,
          secret: authSecret,
          secureCookies: true,
          sessionKeys: authSessionKeys,
        })
        const routes = Layer.mergeAll(
          auth.layer,
          apiRoutes(auth),
          HttpRouter.add('GET', '/api/health', health(observabilityBase.release)),
          browserTelemetryRoutes(authOrigin, allowTelemetry),
        ).pipe(Layer.provide(AlchemyHttp.Platform))
        const handle = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie)
        return { handle, observabilityBase }
      }),
    )
    const fetch = Effect.gen(function* () {
      const env = yield* Cloudflare.Workers.WorkerEnvironment
      const { handle, observabilityBase } = yield* application(env)
      const request = yield* HttpServerRequest
      const metadata = metadataFromHeaders(observabilityBase, request.headers)
      return yield* handle.pipe(withObservability('styld.http', metadata))
    }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs))
    return { fetch }
  }).pipe(Effect.provide(Runtime)),
)
