import { provideAllCatalogs } from '@styld/i18n/all'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { type EmailEntryOptions, ProofDispatchSink } from '@styld/auth'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { Effect, Layer, Logger, Option, Stream } from 'effect'
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
import type { RunClef } from './capture/Clef.ts'
import { captureRoutes } from './capture/Http.ts'
import { type AnalyticsDataset, CaptureMetrics as CaptureMetricsService } from './capture/Metrics.ts'
import { pieceCutout } from './capture/PieceCutout.ts'
import type { CaptureConfig } from './capture/Policy.ts'
import { GarmentSegmenter, GarmentVision, ImageGenerator, PictureWork, VideoGenerator } from './capture/Providers.ts'
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
  StyldGenerationQueue,
  StyldDatabase,
  StyldEmail,
  StyldMedia,
  StyldPieceQueue,
  StyldStylistQueue,
} from './Resources.ts'
import { type CheckBindings, makeChecks } from './safety/Checks.ts'
import { contentJudge, type RunGuard } from './safety/Judge.ts'
import { pieceChangedLayer } from './safety/PieceChanged.ts'
import { checkAttempts, settleCheck } from './safety/Queue.ts'
import { type MoodPlanner, plannerModel, type RunPlanner } from './generation/Planner.ts'
import type { PicturePainter } from './generation/Painter.ts'
import { generationAttempts, settleGeneration } from './generation/Queue.ts'
import { type GenerationBindings, Generations, makeGenerations } from './generation/Service.ts'
import { wardrobeRoutes } from './wardrobe/Http.ts'
import { processingAttempts, settleMessage } from './wardrobe/Queue.ts'
import { makeWardrobe, Wardrobe, type WardrobeBindings } from './wardrobe/Wardrobe.ts'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@styld/observability'
import { asDelivery } from './QueueDelivery.ts'
import { StylistChats } from './stylist/Http.ts'
import { settleStylistTurn, stylistAttempts } from './stylist/Queue.ts'
import { Stylist } from './stylist/StylistObject.ts'
import { chatStoreOf, makeStylistLive } from './stylist/Live.ts'
import { askStandIn, captureProviders } from './capture/Live.ts'

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
  Cloudflare.Workers.CronEventSourceLive,
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
  bindings: WardrobeBindings & {
    readonly checksQueue: CheckBindings['queue']
    readonly generationQueue: GenerationBindings['queue']
    /** Forget an account's chats with Styld, when it is deleted. */
    readonly forgetChats: (accountId: string) => Effect.Effect<void, unknown>
  },
  judge: ReturnType<typeof contentJudge>,
  providers: Layer.Layer<
    | PicturePainter
    | MoodPlanner
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
    const lifecycleService = yield* makeAccountLifecycle(bindings, bindings.forgetChats)
    const capturesService = yield* makeCaptures(bindings).pipe(Effect.provide(pieceChanged))
    const looksService = yield* makeLooks(bindings.database, checksService)
    const boardsService = yield* makeBoards(bindings, checksService)
    const profilesService = makeProfiles(bindings.database, checksService)
    const publicPagesService = yield* makePublicPages(bindings, checksService)
    const socialService = yield* makeSocial(bindings.database, publicPagesService, checksService)
    const discoveryService = makeDiscovery(bindings.database, publicPagesService)
    const generationsService = yield* makeGenerations({
      ...bindings,
      queue: bindings.generationQueue,
      boards: boardsService,
      wardrobe: wardrobeService,
    }).pipe(Effect.provide(judge))
    return {
      // The credits and the provider-call counter the capture providers were built with, for Styld's replies too.
      usage: yield* Usage,
      metrics: yield* CaptureMetricsService,
      generationsService,
      generations: Layer.succeed(Generations, generationsService),
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
  generations: services.generationsService,
})

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
  const generationQueueResource = yield* StyldGenerationQueue
  const generationQueue = yield* Cloudflare.Queues.WriteQueue(generationQueueResource)
  // Styld's chats, one Durable Object per account, and the queue that writes its replies.
  const stylistQueueResource = yield* StyldStylistQueue
  const stylist = {
    objects: yield* Stylist,
    queueResource: stylistQueueResource,
    queue: yield* Cloudflare.Queues.WriteQueue(stylistQueueResource),
  }
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
  const linkLimit = yield* Cloudflare.Workers.RateLimit('LINK_IMPORT_RATE_LIMIT', {
    namespaceId: 2610286,
    simple: { limit: 10, period: 60 },
  })
  // Generated pictures cost credits and a model's time; each account may ask six times a minute.
  const generateLimit = yield* Cloudflare.Workers.RateLimit('GENERATE_RATE_LIMIT', {
    namespaceId: 2610287,
    simple: { limit: 6, period: 60 },
  })
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
    generationQueueResource,
    generationQueue,
    stylist,
    ai,
    calls,
    allowTelemetry,
    allowRegistration,
    allowCheck,
    linkLimit,
    generateLimit,
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
    runPlanner: ((input) => aiRaw.run(plannerModel, input)) satisfies RunPlanner,
    judge: contentJudge(env.CHECKS === 'stand-in' ? Option.none() : Option.some({ runClef, runGuard })),
  }
}

/** Every storage service over the Worker's bindings, with the providers its environment names. */
const applicationServices = (
  env: Cloudflare.Workers.WorkerEnvironment['Service'],
  bindings: Omit<Parameters<typeof storageServices>[0], 'forgetChats'>,
  runtime: {
    readonly ai: Parameters<typeof workersModels>[1]
    readonly dataset: AnalyticsDataset
    readonly origin: { readonly environment: string; readonly release: string }
    readonly stylist: Effect.Success<typeof declareBindings>['stylist']
  },
) =>
  Effect.gen(function* () {
    const { runClef, runPlanner, judge } = workersModels(env, runtime.ai)
    const providers = captureProviders(env, {
      runClef,
      runPlanner,
      images: bindings.images,
      bucket: bindings.bucket,
      dataset: runtime.dataset,
      origin: runtime.origin,
    })
    const chatsOf = chatStoreOf(runtime.stylist.objects)
    const services = yield* storageServices(
      { ...bindings, forgetChats: (accountId) => chatsOf(accountId).erase() },
      judge,
      providers,
    )
    // Styld answers with the assistants' own tools, for the account.
    const stylistService = yield* makeStylistLive({
      env,
      chatsOf,
      queue: yield* runtime.stylist.queue.raw,
      // SAFETY: Styld's model is a Workers AI chat model its policy names, outside the pinned workers-types model list -- the input is the Chat Completions body the OpenAI-compatible client built and workersAiFetch decoded
      runChat: (model, input) => runtime.ai.run(model as never, input as never),
      db: bindings.database,
      tools: toolServices(services),
      storage: services,
    })
    return { ...services, stylistService, stylist: Layer.succeed(StylistChats, stylistService) }
  })

/** The application over the Worker's bindings, built from the request runtime's environment. */
const makeApplication =
  ({
    database,
    email,
    media,
    images,
    pieceQueue,
    checksQueue,
    generationQueue,
    stylist,
    ai,
    calls,
    allowTelemetry,
    allowRegistration,
    allowCheck,
    linkLimit,
    generateLimit,
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
      // Fetching from the web and generating pictures keep one pace per account, on the website and for assistants.
      const pacing = { link: sharedLimit(yield* linkLimit.raw), generate: sharedLimit(yield* generateLimit.raw) }
      const authOrigin = configuration.origin
      const auth = makeAuthHttp(database, authOptions(configuration, yield* email.raw))
      const db = yield* database.raw
      const services = yield* applicationServices(
        env,
        {
          database: db,
          bucket: yield* media.raw,
          images: yield* images.raw,
          queue: yield* pieceQueue.raw,
          checksQueue: yield* checksQueue.raw,
          generationQueue: yield* generationQueue.raw,
        },
        { ai: yield* ai.raw, dataset: yield* calls.raw, origin: observabilityBase, stylist },
      )
      const { wardrobeService, lifecycleService, capturesService, wardrobe, captures, boards } = services
      const oauth = makeMcpOAuth(db, auth, { origin: authOrigin, keys: configuration.sessionKeys, allowRegistration })
      const routes = Layer.mergeAll(
        auth.layer,
        apiRoutes(auth, services, { allowCheck, allowLink: pacing.link, allowGenerate: pacing.generate, allowRead }),
        publicImageRoutes(allowRead).pipe(Layer.provide(services.publicPages)),
        wardrobeRoutes(auth).pipe(Layer.provide(wardrobe)),
        boardRoutes(auth).pipe(Layer.provide(boards)),
        captureRoutes(auth).pipe(Layer.provide(captures)),
        oauth.routes,
        mcpRoutes(
          db,
          authOrigin,
          observabilityBase.release,
          { ...toolServices(services), curation: services.curationService, pacing },
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
        generations: services.generationsService,
        stylist: services.stylistService,
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
          yield* Stream.runForEach(messages, (message) =>
            settleMessage(services, message).pipe(asDelivery(services.observabilityBase, 'pieces', message)),
          )
        }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    yield* Cloudflare.Queues.consumeQueueMessages(
      bindings.checksQueueResource,
      { batchSize: 10, maxRetries: checkAttempts, retryDelay: '30 seconds' },
      (messages) =>
        Effect.gen(function* () {
          const { checks, observabilityBase } = yield* application(yield* Cloudflare.Workers.WorkerEnvironment)
          yield* Stream.runForEach(messages, (message) =>
            settleCheck(checks, message).pipe(asDelivery(observabilityBase, 'checks', message)),
          )
        }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    yield* Cloudflare.Queues.consumeQueueMessages(
      bindings.generationQueueResource,
      { batchSize: 4, maxRetries: generationAttempts, retryDelay: '20 seconds' },
      (messages) =>
        Effect.gen(function* () {
          const { generations, observabilityBase } = yield* application(yield* Cloudflare.Workers.WorkerEnvironment)
          yield* Stream.runForEach(messages, (message) =>
            settleGeneration(generations, message).pipe(asDelivery(observabilityBase, 'generation', message)),
          )
        }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    yield* Cloudflare.Queues.consumeQueueMessages(
      bindings.stylist.queueResource,
      { batchSize: 1, maxRetries: stylistAttempts, retryDelay: '5 seconds' },
      (messages) =>
        Effect.gen(function* () {
          const { stylist, observabilityBase } = yield* application(yield* Cloudflare.Workers.WorkerEnvironment)
          yield* Stream.runForEach(messages, (message) =>
            settleStylistTurn(stylist, message).pipe(asDelivery(observabilityBase, 'stylist', message)),
          )
        }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    // Every ten minutes: generation jobs and checks whose messages were lost go to their queues again.
    yield* Cloudflare.Workers.cron('*/10 * * * *', () =>
      Effect.gen(function* () {
        const { generations, checks, observabilityBase } = yield* application(
          yield* Cloudflare.Workers.WorkerEnvironment,
        )
        yield* Effect.all([generations.sweep(), checks.sweep()], { discard: true }).pipe(
          withObservability('styld.cron', { ...observabilityBase, kind: 'cron.sweep' }),
        )
      }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    return { fetch }
  }).pipe(Effect.provide(Runtime)),
)
