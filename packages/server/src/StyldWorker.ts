import { provideAllCatalogs } from '@styld/i18n/all'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { ProofDispatchSink } from '@styld/auth'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { Effect, Layer, Logger, Stream } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as UrlParams from 'effect/http/UrlParams'
import { browserTelemetryRoutes } from './BrowserTelemetry.ts'
import { AccountLifecycle, makeAccountLifecycle } from './AccountLifecycle.ts'
import { Looks, makeLooks } from './looks/Looks.ts'
import { Boards, makeBoards } from './boards/Boards.ts'
import { makeProfiles, Profiles } from './social/Profiles.ts'
import { makePublicPages, PublicPages } from './social/Public.ts'
import { publicImageRoutes } from './social/PublicHttp.ts'
import { makeSocial, Social } from './social/Social.ts'
import { Discovery, makeDiscovery } from './social/Discovery.ts'
import { boardRoutes } from './boards/Http.ts'
import { makeWorn, Worn } from './worn/Worn.ts'
import { apiRoutes } from './Api.ts'
import { makeAuthHttp, withCodeRequestPolicy } from './AuthHttp.ts'
import { captureRoutes } from './capture/Http.ts'
import { Captures, makeCaptures } from './capture/Service.ts'
import { Holds } from './usage/Holds.ts'
import { DomainLive } from './DomainLive.ts'
import { authOptions } from './AuthConfiguration.ts'
import { pieceCutout } from './capture/PieceCutout.ts'
import { analyticsEngine, CaptureMetrics as CaptureMetricsService } from './capture/Metrics.ts'
import { makeCuration } from './social/Curation.ts'
import { deploymentOf } from './Config.ts'
import { liveProviders, type ProvidersFor, StylistModel, type WorkersAiCalls } from './Providers.ts'
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
import { pieceChangedLayer } from './safety/PieceChanged.ts'
import { checkJobQueue, checkJobs } from './safety/Queue.ts'
import { generationJobQueue, generationJobs } from './generation/Queue.ts'
import { type GenerationBindings, Generations, makeGenerations } from './generation/Service.ts'
import { wardrobeRoutes } from './wardrobe/Http.ts'
import { pieceJobQueue, pieceJobs } from './wardrobe/Queue.ts'
import type { WardrobeBindings } from './wardrobe/Parts.ts'
import { makeWardrobe, Wardrobe } from './wardrobe/Wardrobe.ts'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@styld/observability'
import { applicationSweeps } from './jobs/Cron.ts'
import { runSweeps } from './jobs/Sweeps.ts'
import { consume, consumerSettings, type JobQueue, type JobsOf, type Tagged } from './jobs/Jobs.ts'
import { StylistChats } from './stylist/Http.ts'
import { stylistJobQueue, stylistJobs } from './stylist/Queue.ts'
import { Stylist } from './stylist/StylistObject.ts'
import { chatStoreOf, makeStylistLive } from './stylist/Live.ts'
import { outfitsLive } from './outfits/Live.ts'
import { photoRoutes } from './photos/Http.ts'
import { makePhotoParts } from './photos/Finding.ts'
import { makePhotos, Photos } from './photos/Photos.ts'
import { Outfits, type OutfitParts } from './outfits/Outfits.ts'

// The server formats in every language: page renders and code emails.
provideAllCatalogs()

/** The Cloudflare and Domain services the API Worker runs on. */
export const Runtime = Layer.mergeAll(
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
/** A Workers RateLimit binding that allows `limit` a minute for each key. */
const perMinuteLimit = (name: string, namespaceId: number, limit: number) =>
  Cloudflare.Workers.RateLimit(name, { namespaceId, simple: { limit, period: 60 } })

const perClientLimit = (name: string, namespaceId: number, limit: number) =>
  Effect.gen(function* () {
    const limiter = yield* perMinuteLimit(name, namespaceId, limit)
    return (client: string) =>
      limiter.limit({ key: client }).pipe(
        Effect.map(({ success }) => success),
        Effect.orElseSucceed(() => false),
      )
  })

/** One wardrobe, one account lifecycle, one capture service, the looks, boards and worn days per isolate, shared
 * by the routes and the processing queue. Assistant-added pieces get the same cut-out providers as the tray. */
const storageServices = (
  bindings: WardrobeBindings & {
    readonly checksQueue: CheckBindings['queue']
    readonly generationQueue: GenerationBindings['queue']
    /** Forget an account's chats with Styld, when it is deleted. */
    readonly forgetChats: (accountId: string) => Effect.Effect<void, unknown>
  },
) =>
  Effect.gen(function* () {
    const checksService = yield* makeChecks({ ...bindings, queue: bindings.checksQueue })
    // A piece whose shown picture changes is checked again while others can see it.
    const pieceChanged = pieceChangedLayer(checksService)
    const wardrobeService = yield* makeWardrobe(bindings).pipe(Effect.provide(pieceChanged))
    const lifecycleService = yield* makeAccountLifecycle(bindings, bindings.forgetChats)
    const capturesService = yield* makeCaptures(bindings).pipe(Effect.provide(pieceChanged))
    const looksService = yield* makeLooks(bindings.database, checksService)
    const boardsService = yield* makeBoards(bindings, checksService)
    const photosParts = yield* makePhotoParts(bindings).pipe(Effect.provide(pieceChanged))
    const photosService = yield* makePhotos(photosParts, {
      looks: looksService,
      boards: boardsService,
      uploads: wardrobeService,
    })
    const profilesService = makeProfiles(bindings.database, checksService)
    const publicPagesService = yield* makePublicPages(bindings, checksService)
    const socialService = yield* makeSocial(bindings.database, publicPagesService, checksService)
    const discoveryService = makeDiscovery(bindings.database, publicPagesService)
    const generationsService = yield* makeGenerations({
      ...bindings,
      queue: bindings.generationQueue,
      boards: boardsService,
      wardrobe: wardrobeService,
    })
    return {
      // The credits and the provider-call counter the capture providers were built with, for Styld's replies too.
      holds: yield* Holds,
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
      photosService,
      photos: Layer.succeed(Photos, photosService),
      looks: Layer.succeed(Looks, looksService),
      boards: Layer.succeed(Boards, boardsService),
      worn: Layer.succeed(Worn, makeWorn(bindings.database, yield* CaptureMetricsService)),
      profilesService,
      profiles: Layer.succeed(Profiles, profilesService),
    }
  }).pipe(Effect.provide(Layer.mergeAll(layerCryptoWeb, pieceCutout(bindings.bucket))))

/** The services the assistants' tools project. */
const toolServices = (
  services: Effect.Success<ReturnType<typeof storageServices>>,
  outfits: ToolServices['outfits'],
): ToolServices => ({
  wardrobe: services.wardrobeService,
  looks: services.looksService,
  captures: services.capturesService,
  boards: services.boardsService,
  profiles: services.profilesService,
  social: services.socialService,
  discovery: services.discoveryService,
  generations: services.generationsService,
  outfits,
  accounts: services.lifecycleService,
})

/** A Workers RateLimit binding's runtime object as a check: false when over the limit or failing. */
const sharedLimit = (limiter: { limit(options: { key: string }): Promise<{ success: boolean }> }) => (key: string) =>
  Effect.tryPromise(() => limiter.limit({ key })).pipe(
    Effect.map(({ success }) => success),
    Effect.orElseSucceed(() => false),
  )

/** Each account's pace, on the website and for assistants: fetching from the web, generating pictures, outfits and
 * Thinking. */
const paceOf = (bindings: Effect.Success<typeof declareBindings>) =>
  Effect.gen(function* () {
    return {
      link: sharedLimit(yield* bindings.linkLimit.raw),
      generate: sharedLimit(yield* bindings.generateLimit.raw),
      outfit: sharedLimit(yield* bindings.outfitLimit.raw),
      thinking: sharedLimit(yield* bindings.thinkingLimit.raw),
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
  const linkLimit = yield* perMinuteLimit('LINK_IMPORT_RATE_LIMIT', 2610286, 10)
  // Generated pictures cost credits and a model's time; each account may ask six times a minute.
  const generateLimit = yield* perMinuteLimit('GENERATE_RATE_LIMIT', 2610287, 6)
  // Outfits are free but call Clef; each account may ask thirty times a minute, Thinking six of them.
  const outfitLimit = yield* perMinuteLimit('OUTFIT_RATE_LIMIT', 2610288, 30)
  const thinkingLimit = yield* perMinuteLimit('THINKING_RATE_LIMIT', 2610289, 6)
  // Sign-in codes are real mail from styld.app; each network may ask for five a minute.
  const codeRequests = yield* perMinuteLimit('EMAIL_CODE_RATE_LIMIT', 2610283, 5)
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
    outfitLimit,
    thinkingLimit,
    allowRead,
    codeRequests,
  }
})

/** Clef, the chat models and Llama Guard over the Worker's `AI` binding. */
const workersAiCalls = (ai: Effect.Success<Effect.Success<typeof declareBindings>['ai']['raw']>): WorkersAiCalls => ({
  // SAFETY: Clef-flash is a Workers AI model newer than the pinned workers-types model list -- the request is the System One API shape Clef.ts builds and documents
  runClef: (request) => ai.run('@cf/cloudflare/clef-flash' as never, request as never),
  // SAFETY: the text models Styld asks are Workers AI chat models outside the pinned workers-types model list -- the input is the Chat Completions body the caller built
  runChat: (model, input) => ai.run(model as never, input as never),
  runGuard: ({ messages }) =>
    ai.run('@cf/meta/llama-guard-3-8b', { messages: messages.map((message) => ({ ...message })) }),
})

/** Every storage service over the Worker's bindings, on the composition's providers. */
const applicationServices = (
  bindings: Omit<Parameters<typeof storageServices>[0], 'forgetChats'>,
  runtime: {
    readonly origin: string
    readonly stylist: Effect.Success<typeof declareBindings>['stylist']
    readonly pace: OutfitParts['pace']
  },
) =>
  Effect.gen(function* () {
    const chatsOf = chatStoreOf(runtime.stylist.objects)
    const services = yield* storageServices({ ...bindings, forgetChats: (accountId) => chatsOf(accountId).erase() })
    const outfitsService = yield* outfitsLive({
      database: bindings.database,
      bindings,
      metrics: services.metrics,
      pace: runtime.pace,
    })
    // Styld answers with the assistants' own tools, for the account.
    const stylistService = yield* makeStylistLive({
      origin: runtime.origin,
      model: yield* StylistModel,
      chatsOf,
      queue: yield* runtime.stylist.queue.raw,
      tools: toolServices(services, outfitsService),
      storage: services,
    })
    return {
      ...services,
      stylistService,
      stylist: Layer.succeed(StylistChats, stylistService),
      outfitsService,
      outfits: Layer.succeed(Outfits, outfitsService),
    }
  })

/** The application over the Worker's bindings, built from the request runtime's environment. */
const makeApplication =
  (bindings: Effect.Success<typeof declareBindings>, providersFor: ProvidersFor) =>
  (env: Cloudflare.Workers.WorkerEnvironment['Service']) =>
    Effect.gen(function* () {
      const deployment = yield* deploymentOf(env)
      const observabilityBase = yield* makeObservabilityBase({
        environment: deployment.environment,
        release: deployment.release,
        component: 'server',
      }).pipe(Effect.orDie)
      const configuration = deployment.auth
      const metrics = analyticsEngine(yield* bindings.calls.raw, observabilityBase)
      const bucket = yield* bindings.media.raw
      const images = yield* bindings.images.raw
      const workersAi = workersAiCalls(yield* bindings.ai.raw)
      const providers = providersFor({ workersAi, images, bucket, metrics, deployment, env })
      // Auth checks the limit inside its own operations, which do not carry this request's
      // runtime context, so it gets the binding's runtime object.
      const allowCodeRequest = sharedLimit(yield* bindings.codeRequests.raw)
      const pacing = yield* paceOf(bindings)
      const authOrigin = configuration.origin
      const auth = makeAuthHttp(bindings.database, authOptions(configuration, yield* bindings.email.raw, emailSender))
      const db = yield* bindings.database.raw
      const services = yield* applicationServices(
        {
          database: db,
          bucket,
          images,
          queue: yield* bindings.pieceQueue.raw,
          checksQueue: yield* bindings.checksQueue.raw,
          generationQueue: yield* bindings.generationQueue.raw,
        },
        { origin: authOrigin, stylist: bindings.stylist, pace: pacing },
      ).pipe(Effect.provide(Layer.mergeAll(providers, Holds.layer, Layer.succeed(CaptureMetricsService, metrics))))
      const { wardrobeService, lifecycleService, capturesService, wardrobe, captures, boards } = services
      const oauth = makeMcpOAuth(db, auth, {
        origin: authOrigin,
        keys: configuration.sessionKeys,
        allowRegistration: bindings.allowRegistration,
      })
      const routes = Layer.mergeAll(
        auth.layer,
        apiRoutes(auth, services, {
          allowCheck: bindings.allowCheck,
          allowLink: pacing.link,
          allowGenerate: pacing.generate,
          allowRead: bindings.allowRead,
        }),
        publicImageRoutes(bindings.allowRead).pipe(Layer.provide(services.publicPages)),
        wardrobeRoutes(auth).pipe(Layer.provide(wardrobe)),
        boardRoutes(auth).pipe(Layer.provide(boards)),
        captureRoutes(auth).pipe(Layer.provide(captures)),
        photoRoutes(auth).pipe(Layer.provide(services.photos)),
        oauth.routes,
        mcpRoutes(
          db,
          authOrigin,
          observabilityBase.release,
          { ...toolServices(services, services.outfitsService), curation: services.curationService, pacing },
          deployment.admins,
        ).pipe(Layer.provide(oauth.server)),
        HttpRouter.add('GET', '/api/health', health(observabilityBase.release)),
        browserTelemetryRoutes(authOrigin, bindings.allowTelemetry),
      ).pipe(Layer.provide(AlchemyHttp.Platform))
      const handle = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie)
      return {
        handle,
        observabilityBase,
        wardrobe: wardrobeService,
        lifecycle: lifecycleService,
        captures: capturesService,
        photos: services.photosService,
        checks: services.checksService,
        generations: services.generationsService,
        stylist: services.stylistService,
        sweeps: applicationSweeps(db, services),
        allowCodeRequest,
      }
    })

export class StyldWorker extends Cloudflare.Worker<StyldWorker, Cloudflare.WorkerShape>()('StyldWorker') {}

/** How the API Worker is deployed, from the module that is its entry. */
export const workerOptions = (main: string) => ({
  main,
  // Keep local workerd and deployed Workers on the same supported date; telemetry needs >= 2026-07-28.
  compatibility: { date: '2026-10-19' },
  workersDev: { enabled: false, previewsEnabled: false },
  observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: true } },
})

/** The API Worker's program on a composition's providers, run on `Runtime`: the Worker's own are the live ones (below);
 * the native suite runs it on its fakes (`test/NativeWorker.ts`). */
export const styldProgram = (providersFor: ProvidersFor) =>
  Effect.gen(function* () {
    const bindings = yield* declareBindings
    // Bindings configured by the stack (including the web origin and secrets)
    // exist only in the deployed request runtime, not while Alchemy evaluates
    // the Worker declaration during planning. Build the application on the
    // first request and reuse it for every later request in this isolate.
    const application = yield* onFirstUse(makeApplication(bindings, providersFor))
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
    /** Consume a queue's deliveries with the application its first delivery built. */
    const consumer = <Body extends Tagged>(
      resource: Parameters<typeof Cloudflare.Queues.consumeQueueMessages>[0],
      queue: JobQueue<Body>,
      jobsOf: (services: Effect.Success<ReturnType<ReturnType<typeof makeApplication>>>) => JobsOf<Body>,
    ) =>
      Cloudflare.Queues.consumeQueueMessages(resource, consumerSettings(queue), (messages) =>
        Effect.gen(function* () {
          const services = yield* application(yield* Cloudflare.Workers.WorkerEnvironment)
          yield* Stream.runForEach(messages, consume(queue, services.observabilityBase, jobsOf(services)))
        }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
      )
    yield* consumer(bindings.pieceQueueResource, pieceJobQueue, pieceJobs)
    yield* consumer(bindings.checksQueueResource, checkJobQueue, ({ checks }) => checkJobs(checks))
    yield* consumer(bindings.generationQueueResource, generationJobQueue, ({ generations }) =>
      generationJobs(generations),
    )
    yield* consumer(bindings.stylist.queueResource, stylistJobQueue, ({ stylist }) => stylistJobs(stylist))
    // Every ten minutes, every sweep on its own (`jobs/Sweeps.ts`): nothing stays pending forever.
    yield* Cloudflare.Workers.cron('*/10 * * * *', () =>
      Effect.gen(function* () {
        const { sweeps, observabilityBase } = yield* application(yield* Cloudflare.Workers.WorkerEnvironment)
        yield* runSweeps(sweeps).pipe(withObservability('styld.cron', { ...observabilityBase, kind: 'cron.sweep' }))
      }).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    return { fetch }
  })

export default StyldWorker.make(
  workerOptions(import.meta.url),
  styldProgram(liveProviders).pipe(Effect.provide(Runtime)),
)
