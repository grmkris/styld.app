import { provideAllCatalogs } from '@styld/i18n/all'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { ProofDispatchSink } from '@styld/auth'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { Effect, Layer, Logger, Stream } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import {
  decodeAuthSecret,
  decodeAuthSessionKeyring,
  decodeProofKeyring,
  decodeRequestBindingKeyring,
} from './AuthConfiguration.ts'
import { browserTelemetryRoutes } from './BrowserTelemetry.ts'
import { AccountLifecycle, makeAccountLifecycle } from './AccountLifecycle.ts'
import { apiRoutes } from './Api.ts'
import { makeAuthHttp, withRequestNetwork } from './AuthHttp.ts'
import { DomainLive } from './DomainLive.ts'
import { health } from './Health.ts'
import { onFirstUse } from './IsolateCache.ts'
import { mcpRoutes } from './mcp/Route.ts'
import { makeMcpOAuth } from './OAuth.ts'
import { emailSender, StyldDatabase, StyldEmail, StyldMedia, StyldPieceQueue } from './Resources.ts'
import { wardrobeRoutes } from './wardrobe/Http.ts'
import { GarmentCutout } from './wardrobe/Processing.ts'
import { processingAttempts, settlePieceMessage } from './wardrobe/Queue.ts'
import { makeWardrobe, Wardrobe, type WardrobeBindings } from './wardrobe/Wardrobe.ts'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@styld/observability'

// The server formats in every language: page renders and code emails.
provideAllCatalogs()

const Runtime = Layer.mergeAll(
  DomainLive,
  Cloudflare.Telemetry({ headSamplingRate: 1 }),
  Cloudflare.D1.QueryDatabaseBinding,
  Cloudflare.Workers.RateLimitBinding,
  Cloudflare.Email.SendBinding,
  Cloudflare.R2.ReadWriteBucketBinding,
  Cloudflare.Images.ImagesBinding,
  Cloudflare.Queues.WriteQueueBinding,
  Cloudflare.Queues.EventSourceLive,
)

/** A per-IP limit of `limit` requests a minute. A limiter error refuses: a limit is never worth an
 * outage or an open door. */
const perClientLimit = (name: string, namespaceId: number, limit: number) =>
  Effect.gen(function* () {
    const limiter = yield* Cloudflare.Workers.RateLimit(name, { namespaceId, simple: { limit, period: 60 } })
    return (client: string) =>
      limiter.limit({ key: client }).pipe(
        Effect.map(({ success }) => success),
        Effect.orElseSucceed(() => false),
      )
  })

/** One wardrobe and one account lifecycle per isolate, shared by the routes and the processing
 * queue. Photos keep their original until the garment cut-out model replaces `keepOriginal`. */
const storageServices = (bindings: WardrobeBindings) =>
  Effect.gen(function* () {
    const wardrobeService = yield* makeWardrobe(bindings)
    const lifecycle = yield* makeAccountLifecycle(bindings)
    return {
      wardrobeService,
      wardrobe: Layer.succeed(Wardrobe, wardrobeService),
      lifecycle: Layer.succeed(AccountLifecycle, lifecycle),
    }
  }).pipe(Effect.provide([layerCryptoWeb, GarmentCutout.keepOriginal]))

/** The auth origin and keyrings bound as secrets. Missing or malformed ones stop the Worker. */
const authConfiguration = (env: Cloudflare.Workers.WorkerEnvironment['Service']) =>
  Effect.gen(function* () {
    const origin: unknown = env.AUTH_ORIGIN
    if (typeof origin !== 'string' || origin.length === 0)
      return yield* Effect.die(new Error('AUTH_ORIGIN binding is required'))
    return {
      origin,
      sessionKeys: yield* decodeAuthSessionKeyring(env.AUTH_SESSION_KEYS).pipe(Effect.orDie),
      secret: yield* decodeAuthSecret(env.AUTH_SECRET).pipe(Effect.orDie),
      proofKeys: yield* decodeProofKeyring(env.AUTH_PROOF_KEYS).pipe(Effect.orDie),
      requestBindingKeys: yield* decodeRequestBindingKeyring(env.AUTH_REQUEST_BINDING_KEYS).pipe(Effect.orDie),
    }
  })

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
    const email = yield* Cloudflare.Email.Send(yield* StyldEmail)
    const media = yield* Cloudflare.R2.ReadWriteBucket(StyldMedia)
    const images = yield* Cloudflare.Images.Images('STYLD_IMAGES')
    const pieceQueueResource = yield* StyldPieceQueue
    const pieceQueue = yield* Cloudflare.Queues.WriteQueue(pieceQueueResource)
    // The browser telemetry relay is unauthenticated; each client IP may post 120 times a
    // minute (the SDK flushes about twice every 5 seconds per tab).
    const allowTelemetry = yield* perClientLimit('TELEMETRY_RATE_LIMIT', 2610281, 120)
    // Dynamic client registration is open to anyone; each IP may register ten clients a minute.
    const allowRegistration = yield* perClientLimit('OAUTH_REGISTER_RATE_LIMIT', 2610282, 10)
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
        const configuration = yield* authConfiguration(env)
        const authOrigin = configuration.origin
        const auth = makeAuthHttp(database, {
          origin: authOrigin,
          secret: configuration.secret,
          secureCookies: true,
          sessionKeys: configuration.sessionKeys,
          email: {
            sender: yield* email.raw,
            from: emailSender,
            proofKeys: configuration.proofKeys,
            requestBindingKeys: configuration.requestBindingKeys,
            returnTargets: ['/'],
          },
        })
        const db = yield* database.raw
        const { wardrobeService, wardrobe, lifecycle } = yield* storageServices({
          database: db,
          bucket: yield* media.raw,
          images: yield* images.raw,
          queue: yield* pieceQueue.raw,
        })
        const oauth = makeMcpOAuth(db, auth, { origin: authOrigin, keys: configuration.sessionKeys, allowRegistration })
        const routes = Layer.mergeAll(
          auth.layer,
          apiRoutes(auth, { wardrobe, lifecycle }),
          wardrobeRoutes(auth).pipe(Layer.provide(wardrobe)),
          oauth.routes,
          mcpRoutes(db, authOrigin, observabilityBase.release, wardrobeService).pipe(Layer.provide(oauth.server)),
          HttpRouter.add('GET', '/api/health', health(observabilityBase.release)),
          browserTelemetryRoutes(authOrigin, allowTelemetry),
        ).pipe(Layer.provide(AlchemyHttp.Platform))
        const handle = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie)
        return { handle, observabilityBase, wardrobe: wardrobeService }
      }),
    )
    const fetch = Effect.gen(function* () {
      const env = yield* Cloudflare.Workers.WorkerEnvironment
      const { handle, observabilityBase } = yield* application(env)
      const request = yield* HttpServerRequest
      const metadata = metadataFromHeaders(observabilityBase, request.headers)
      // Code emails go out after the response, kept alive by this request's waitUntil. The sink
      // closes over this request's live execution context: auth's services were built on first use
      // and see only the deferred one, which refuses to run outside the handler.
      const execution = yield* Cloudflare.Workers.WorkerExecutionContext
      const runtime = yield* RuntimeContext
      const dispatch = (work: Effect.Effect<void>) =>
        execution.waitUntil(work).pipe(Effect.provideService(RuntimeContext, runtime))
      return yield* handle.pipe(
        Effect.provideService(ProofDispatchSink, dispatch),
        withRequestNetwork(request.headers),
        withObservability('styld.http', metadata),
      )
    }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs))
    yield* Cloudflare.Queues.consumeQueueMessages(
      pieceQueueResource,
      { batchSize: 10, maxRetries: processingAttempts, retryDelay: '10 seconds' },
      (messages) =>
        Effect.gen(function* () {
          const { wardrobe } = yield* application(yield* Cloudflare.Workers.WorkerEnvironment)
          yield* Stream.runForEach(messages, (message) => settlePieceMessage(wardrobe, message))
        }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    return { fetch }
  }).pipe(Effect.provide(Runtime)),
)
