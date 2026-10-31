import { provideAllCatalogs } from '@styld/i18n/all'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { type EmailEntryOptions, ProofDispatchSink } from '@styld/auth'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { Effect, Layer, Logger, Option, Redacted, Stream } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as UrlParams from 'effect/http/UrlParams'
import {
  type AuthHttpOptions,
  decodeAuthSecret,
  decodeAuthSessionKeyring,
  decodeProofKeyring,
  decodeRequestBindingKeyring,
} from './AuthConfiguration.ts'
import { browserTelemetryRoutes } from './BrowserTelemetry.ts'
import { AccountLifecycle, makeAccountLifecycle } from './AccountLifecycle.ts'
import { Looks, makeLooks } from './looks/Looks.ts'
import { Boards, makeBoards } from './boards/Boards.ts'
import { makeProfiles, Profiles } from './social/Profiles.ts'
import { makePublicPages, PublicPages } from './social/Public.ts'
import { publicImageRoutes } from './social/PublicHttp.ts'
import { makeSocial, Social } from './social/Social.ts'
import { Discovery, makeDiscovery } from './social/Discovery.ts'
import { adminEmails, makeCuration } from './social/Curation.ts'
import { boardRoutes } from './boards/Http.ts'
import { makeWorn, Worn } from './worn/Worn.ts'
import { apiRoutes } from './Api.ts'
import { makeAuthHttp, withCodeRequestPolicy } from './AuthHttp.ts'
import { type ClefRequest, makeGarmentVision, type RunClef } from './capture/Clef.ts'
import { makePictureWork } from './capture/CloudflareImages.ts'
import { captureRoutes } from './capture/Http.ts'
import { makeGarmentSegmenter } from './capture/Meta.ts'
import { type AnalyticsDataset, analyticsEngine, CaptureMetrics as CaptureMetricsService } from './capture/Metrics.ts'
import { pieceCutout } from './capture/PieceCutout.ts'
import { CaptureConfig, capturePolicy } from './capture/Policy.ts'
import { makeMuseGenerator } from './capture/Muse.ts'
import { GarmentSegmenter, GarmentVision, ImageGenerator, PictureWork, VideoGenerator } from './capture/Providers.ts'
import { makeVeoGenerator } from './capture/Veo.ts'
import { Captures, makeCaptures } from './capture/Service.ts'
import { Usage } from './capture/Usage.ts'
import { DomainLive } from './DomainLive.ts'
import { health } from './Health.ts'
import { onFirstUse } from './IsolateCache.ts'
import { mcpRoutes } from './mcp/Route.ts'
import type { ToolServices } from './mcp/StyldTools.ts'
import { makeMcpOAuth } from './OAuth.ts'
import {
  emailSender,
  StyldAiCalls,
  StyldChecksQueue,
  StyldDatabase,
  StyldEmail,
  StyldMedia,
  StyldPieceQueue,
} from './Resources.ts'
import { type CheckBindings, makeChecks } from './safety/Checks.ts'
import { contentJudge, type RunGuard } from './safety/Judge.ts'
import { pieceChangedLayer } from './safety/PieceChanged.ts'
import { checkAttempts, settleCheck } from './safety/Queue.ts'
import { wardrobeRoutes } from './wardrobe/Http.ts'
import { processingAttempts, settleMessage } from './wardrobe/Queue.ts'
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
  Cloudflare.Workers.AIBinding,
  Cloudflare.AnalyticsEngine.WriteDatasetBinding,
  // Traces record request URLs; upload paths carry a one-time token in `token`.
  Layer.succeed(UrlParams.CurrentRedactedNames, [...UrlParams.CurrentRedactedNames.defaultValue(), 'token']),
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

/** One wardrobe, one account lifecycle, one capture service, the looks, boards and worn days per isolate, shared
 * by the routes and the processing queue. Assistant-added pieces get the same cut-out providers as the tray. */
const storageServices = <R>(
  bindings: WardrobeBindings & { readonly checksQueue: CheckBindings['queue'] },
  judge: ReturnType<typeof contentJudge>,
  providers: Layer.Layer<
    | GarmentVision
    | PictureWork
    | GarmentSegmenter
    | ImageGenerator
    | VideoGenerator
    | Usage
    | CaptureConfig
    | CaptureMetricsService,
    never,
    R
  >,
) =>
  Effect.gen(function* () {
    const checksService = yield* makeChecks({ ...bindings, queue: bindings.checksQueue }).pipe(Effect.provide(judge))
    // A piece whose shown picture changes is checked again while others can see it.
    const pieceChanged = pieceChangedLayer(checksService)
    const wardrobeService = yield* makeWardrobe(bindings).pipe(Effect.provide(pieceChanged))
    const lifecycleService = yield* makeAccountLifecycle(bindings)
    const capturesService = yield* makeCaptures(bindings).pipe(Effect.provide(pieceChanged))
    const looksService = yield* makeLooks(bindings.database, checksService)
    const boardsService = yield* makeBoards(bindings, checksService)
    const profilesService = makeProfiles(bindings.database, checksService)
    const publicPagesService = yield* makePublicPages(bindings, checksService)
    const socialService = yield* makeSocial(bindings.database, publicPagesService, checksService)
    const discoveryService = makeDiscovery(bindings.database, publicPagesService)
    return {
      curationService: makeCuration(bindings.database, checksService),
      discoveryService,
      discovery: Layer.succeed(Discovery, discoveryService),
      publicPages: Layer.succeed(PublicPages, publicPagesService),
      socialService,
      social: Layer.succeed(Social, socialService),
      checksService,
      wardrobeService,
      lifecycleService,
      capturesService,
      looksService,
      boardsService,
      wardrobe: Layer.succeed(Wardrobe, wardrobeService),
      lifecycle: Layer.succeed(AccountLifecycle, lifecycleService),
      captures: Layer.succeed(Captures, capturesService),
      looks: Layer.succeed(Looks, looksService),
      boards: Layer.succeed(Boards, boardsService),
      worn: Layer.succeed(Worn, makeWorn(bindings.database)),
      profilesService,
      profiles: Layer.succeed(Profiles, profilesService),
    }
  }).pipe(
    Effect.provide(Layer.mergeAll(layerCryptoWeb, pieceCutout(bindings.bucket)).pipe(Layer.provideMerge(providers))),
  )

/** The services the assistants' tools project. */
const toolServices = (services: Effect.Success<ReturnType<typeof storageServices>>): ToolServices => ({
  wardrobe: services.wardrobeService,
  looks: services.looksService,
  captures: services.capturesService,
  boards: services.boardsService,
  profiles: services.profilesService,
  social: services.socialService,
  discovery: services.discoveryService,
})

/** The capture providers and policy from the Worker's environment. */
const captureProviders = (
  env: Cloudflare.Workers.WorkerEnvironment['Service'],
  runtime: {
    readonly runClef: RunClef
    readonly images: WardrobeBindings['images']
    readonly bucket: WardrobeBindings['bucket']
    readonly dataset: AnalyticsDataset
    readonly origin: { readonly environment: string; readonly release: string }
  },
) => {
  const policy = capturePolicy(env)
  const metrics = analyticsEngine(runtime.dataset, runtime.origin)
  const apiKey: unknown = env.META_API_KEY
  const apiBase: unknown = env.META_API_BASE
  const videoKey: unknown = env.VIDEO_GATEWAY_API_KEY
  const videoBase: unknown = env.VIDEO_GATEWAY_BASE
  const meta = {
    apiBase: typeof apiBase === 'string' && apiBase.length > 0 ? apiBase : 'https://api.meta.ai',
    apiKey: Redacted.make(typeof apiKey === 'string' ? apiKey : ''),
    fetch: (input: string, init: RequestInit) => globalThis.fetch(input, init),
    metrics,
  }
  return Layer.mergeAll(
    Layer.succeed(CaptureConfig, policy),
    Layer.succeed(GarmentVision, makeGarmentVision(runtime.runClef, metrics)),
    Layer.succeed(PictureWork, makePictureWork(runtime.images, metrics)),
    Layer.succeed(
      GarmentSegmenter,
      makeGarmentSegmenter({ ...meta, readVideo: async (key) => (await runtime.bucket.get(key))?.body ?? null }),
    ),
    Layer.succeed(ImageGenerator, policy.pictures.generator === 'muse' ? makeMuseGenerator(meta) : ImageGenerator.off),
    Layer.succeed(
      VideoGenerator,
      policy.turns.generator === 'veo'
        ? makeVeoGenerator({
            apiBase:
              typeof videoBase === 'string' && videoBase.length > 0 ? videoBase : 'https://ai-gateway.vercel.sh/v4/ai',
            apiKey: Redacted.make(typeof videoKey === 'string' ? videoKey : ''),
            fetch: meta.fetch,
            metrics,
          })
        : VideoGenerator.off,
    ),
    Usage.layer(policy.dailyAllowance),
    Layer.succeed(CaptureMetricsService, metrics),
  )
}

/** Clef asked over HTTP, as a stand-in answers it on the native stack. */
const askStandIn = async (url: string, request: ClefRequest): Promise<unknown> => {
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw new Error(`Clef stand-in answered ${response.status}`)
  return response.json()
}

/** A Workers RateLimit binding's runtime object as a check: false when over the limit or failing. */
const sharedLimit = (limiter: { limit(options: { key: string }): Promise<{ success: boolean }> }) => (key: string) =>
  Effect.tryPromise(() => limiter.limit({ key })).pipe(
    Effect.map(({ success }) => success),
    Effect.orElseSucceed(() => false),
  )

/** Auth's options from the secrets, sending code mail from styld.app. */
const authOptions = (
  configuration: Effect.Success<ReturnType<typeof authConfiguration>>,
  sender: EmailEntryOptions['sender'],
): AuthHttpOptions => ({
  origin: configuration.origin,
  secret: configuration.secret,
  secureCookies: true,
  sessionKeys: configuration.sessionKeys,
  email: {
    sender,
    from: emailSender,
    proofKeys: configuration.proofKeys,
    requestBindingKeys: configuration.requestBindingKeys,
    returnTargets: ['/'],
  },
})

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

/** The Worker's bindings, declared while Alchemy plans the stack. */
const declareBindings = Effect.gen(function* () {
  const database = yield* Cloudflare.D1.QueryDatabase(StyldDatabase)
  const email = yield* Cloudflare.Email.Send(yield* StyldEmail)
  const media = yield* Cloudflare.R2.ReadWriteBucket(StyldMedia)
  const images = yield* Cloudflare.Images.Images('STYLD_IMAGES')
  const pieceQueueResource = yield* StyldPieceQueue
  const pieceQueue = yield* Cloudflare.Queues.WriteQueue(pieceQueueResource)
  const checksQueueResource = yield* StyldChecksQueue
  const checksQueue = yield* Cloudflare.Queues.WriteQueue(checksQueueResource)
  // Clef-flash (Workers AI) routes photos and suggests details; provider calls are counted in Analytics Engine.
  const ai = yield* Cloudflare.Workers.AI('AI')
  const calls = yield* Cloudflare.AnalyticsEngine.WriteDataset(yield* StyldAiCalls)
  // The browser telemetry relay is unauthenticated; each client IP may post 120 times a
  // minute (the SDK flushes about twice every 5 seconds per tab).
  const allowTelemetry = yield* perClientLimit('TELEMETRY_RATE_LIMIT', 2610281, 120)
  // Dynamic client registration is open to anyone; each IP may register ten clients a minute.
  const allowRegistration = yield* perClientLimit('OAUTH_REGISTER_RATE_LIMIT', 2610282, 10)
  // The camera's garment check calls Clef; each account may check 40 frames a minute, a few a second at most.
  const allowCheck = yield* perClientLimit('CAPTURE_CHECK_RATE_LIMIT', 2610284, 40)
  // Public pages and their pictures are open to anyone; each network may read 300 a minute.
  const allowRead = yield* perClientLimit('PUBLIC_READ_RATE_LIMIT', 2610285, 300)
  // Reading a shop's product page fetches someone else's site; each account may read ten a minute.
  const allowLink = yield* perClientLimit('LINK_IMPORT_RATE_LIMIT', 2610286, 10)
  // Sign-in codes are real mail from styld.app; each network may ask for five a minute.
  const codeRequests = yield* Cloudflare.Workers.RateLimit('EMAIL_CODE_RATE_LIMIT', {
    namespaceId: 2610283,
    simple: { limit: 5, period: 60 },
  })
  return {
    database,
    email,
    media,
    images,
    pieceQueueResource,
    pieceQueue,
    checksQueueResource,
    checksQueue,
    ai,
    calls,
    allowTelemetry,
    allowRegistration,
    allowCheck,
    allowLink,
    allowRead,
    codeRequests,
  }
})

/** Clef and the judge of what people make public, over the Workers AI binding. */
const workersModels = (
  env: Cloudflare.Workers.WorkerEnvironment['Service'],
  aiRaw: Effect.Success<Effect.Success<typeof declareBindings>['ai']['raw']>,
) => {
  // SAFETY: Clef-flash is a Workers AI model newer than the pinned workers-types model list -- the request is the System One API shape Clef.ts builds and documents
  const workersAi: RunClef = (request) => aiRaw.run('@cf/cloudflare/clef-flash' as never, request as never)
  // Native acceptance only: the local stack cannot reach Workers AI, so it names a stand-in for Clef.
  const clefStandIn: unknown = env.CLEF_API_BASE
  const runClef: RunClef =
    typeof clefStandIn === 'string' && clefStandIn.length > 0
      ? (request) => askStandIn(clefStandIn, request)
      : workersAi
  const runGuard: RunGuard = ({ messages }) =>
    aiRaw.run('@cf/meta/llama-guard-3-8b', { messages: messages.map((message) => ({ ...message })) })
  // Only native acceptance names the stand-in judge.
  return {
    runClef,
    judge: contentJudge(env.CHECKS === 'stand-in' ? Option.none() : Option.some({ runClef, runGuard })),
  }
}

/** The application over the Worker's bindings, built from the request runtime's environment. */
const makeApplication =
  ({
    database,
    email,
    media,
    images,
    pieceQueue,
    checksQueue,
    ai,
    calls,
    allowTelemetry,
    allowRegistration,
    allowCheck,
    allowLink,
    allowRead,
    codeRequests,
  }: Effect.Success<typeof declareBindings>) =>
  (env: Cloudflare.Workers.WorkerEnvironment['Service']) =>
    Effect.gen(function* () {
      const observabilityBase = yield* makeObservabilityBase({
        environment: env.STYLD_ENV,
        release: env.STYLD_RELEASE,
        component: 'server',
      }).pipe(Effect.orDie)
      const configuration = yield* authConfiguration(env)
      // Auth checks the limit inside its own operations, which do not carry this request's
      // runtime context, so it gets the binding's runtime object.
      const allowCodeRequest = sharedLimit(yield* codeRequests.raw)
      const authOrigin = configuration.origin
      const auth = makeAuthHttp(database, authOptions(configuration, yield* email.raw))
      const db = yield* database.raw
      const bucket = yield* media.raw
      const imagesRaw = yield* images.raw
      const { runClef, judge } = workersModels(env, yield* ai.raw)
      const providers = captureProviders(env, {
        runClef,
        images: imagesRaw,
        bucket,
        dataset: yield* calls.raw,
        origin: { environment: observabilityBase.environment, release: observabilityBase.release },
      })
      const services = yield* storageServices(
        {
          database: db,
          bucket,
          images: imagesRaw,
          queue: yield* pieceQueue.raw,
          checksQueue: yield* checksQueue.raw,
        },
        judge,
        providers,
      )
      const { wardrobeService, lifecycleService, capturesService, wardrobe, captures, boards } = services
      const oauth = makeMcpOAuth(db, auth, { origin: authOrigin, keys: configuration.sessionKeys, allowRegistration })
      const routes = Layer.mergeAll(
        auth.layer,
        apiRoutes(auth, services, { allowCheck, allowLink, allowRead }),
        publicImageRoutes(allowRead).pipe(Layer.provide(services.publicPages)),
        wardrobeRoutes(auth).pipe(Layer.provide(wardrobe)),
        boardRoutes(auth).pipe(Layer.provide(boards)),
        captureRoutes(auth).pipe(Layer.provide(captures)),
        oauth.routes,
        mcpRoutes(
          db,
          authOrigin,
          observabilityBase.release,
          { ...toolServices(services), curation: services.curationService },
          adminEmails(env.STYLD_ADMIN_EMAILS),
        ).pipe(Layer.provide(oauth.server)),
        HttpRouter.add('GET', '/api/health', health(observabilityBase.release)),
        browserTelemetryRoutes(authOrigin, allowTelemetry),
      ).pipe(Layer.provide(AlchemyHttp.Platform))
      const handle = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie)
      return {
        handle,
        observabilityBase,
        wardrobe: wardrobeService,
        lifecycle: lifecycleService,
        captures: capturesService,
        checks: services.checksService,
        allowCodeRequest,
      }
    })

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
    const bindings = yield* declareBindings
    // Bindings configured by the stack (including the web origin and secrets)
    // exist only in the deployed request runtime, not while Alchemy evaluates
    // the Worker declaration during planning. Build the application on the
    // first request and reuse it for every later request in this isolate.
    const application = yield* onFirstUse(makeApplication(bindings))
    const fetch = Effect.gen(function* () {
      const env = yield* Cloudflare.Workers.WorkerEnvironment
      const { handle, observabilityBase, allowCodeRequest } = yield* application(env)
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
        withCodeRequestPolicy(request.headers, allowCodeRequest),
        withObservability('styld.http', metadata),
      )
    }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs))
    yield* Cloudflare.Queues.consumeQueueMessages(
      bindings.pieceQueueResource,
      { batchSize: 10, maxRetries: processingAttempts, retryDelay: '10 seconds' },
      (messages) =>
        Effect.gen(function* () {
          const services = yield* application(yield* Cloudflare.Workers.WorkerEnvironment)
          yield* Stream.runForEach(messages, (message) => settleMessage(services, message))
        }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    yield* Cloudflare.Queues.consumeQueueMessages(
      bindings.checksQueueResource,
      { batchSize: 10, maxRetries: checkAttempts, retryDelay: '30 seconds' },
      (messages) =>
        Effect.gen(function* () {
          const { checks } = yield* application(yield* Cloudflare.Workers.WorkerEnvironment)
          yield* Stream.runForEach(messages, (message) => settleCheck(checks, message))
        }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    return { fetch }
  }).pipe(Effect.provide(Runtime)),
)
