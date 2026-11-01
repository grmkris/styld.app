import { provideAllCatalogs } from '@styld/i18n/all'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { ProofDispatchSink } from '@styld/auth'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { Effect, Layer, Logger, Record, Stream } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as UrlParams from 'effect/http/UrlParams'
import { browserTelemetryRoutes } from './BrowserTelemetry.ts'
import { AccountLifecycle, makeAccountLifecycle } from './AccountLifecycle.ts'
import { Looks } from './looks/Looks.ts'
import { Boards } from './boards/Boards.ts'
import { Profiles } from './social/Profiles.ts'
import { PublicPages } from './social/Public.ts'
import { publicImageRoutes } from './social/PublicHttp.ts'
import { Social } from './social/Social.ts'
import { Discovery } from './social/Discovery.ts'
import { boardRoutes } from './boards/Http.ts'
import { Worn } from './worn/Worn.ts'
import { socialServices } from './social/Modules.ts'
import { apiRoutes } from './Api.ts'
import { makeAuthHttp, withCodeRequestPolicy } from './AuthHttp.ts'
import { captureRoutes } from './capture/Http.ts'
import { Captures } from './capture/Service.ts'
import { Holds } from './usage/Holds.ts'
import { DomainLive } from './DomainLive.ts'
import { authOptions } from './AuthConfiguration.ts'
import { pieceCutout } from './capture/PieceCutout.ts'
import { analyticsEngine, CaptureMetrics as CaptureMetricsService } from './capture/Metrics.ts'
import { deploymentOf } from './Config.ts'
import { liveProviders, type ProvidersFor, type WorkersAiCalls } from './Providers.ts'
import { health } from './Health.ts'
import { onFirstUse } from './IsolateCache.ts'
import { mcpRoutes } from './mcp/Route.ts'
import { styldTools, type ToolServices } from './mcp/StyldTools.ts'
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
import type { CheckQueue } from './safety/Checks.ts'
import { PieceChanged } from './safety/PieceChanged.ts'
import { checkJobQueue, checkJobs } from './safety/Queue.ts'
import { GenerationQueue, generationJobQueue, generationJobs } from './generation/Queue.ts'
import { Generations } from './generation/Service.ts'
import { wardrobeRoutes } from './wardrobe/Http.ts'
import { pieceJobQueue, pieceJobs } from './wardrobe/Queue.ts'
import type { WardrobeBindings } from './wardrobe/Parts.ts'
import { Wardrobe } from './wardrobe/Wardrobe.ts'
import { PieceQueue } from './wardrobe/Processing.ts'
import { Database } from './kernel/Db.ts'
import { Media } from './kernel/Media.ts'
import { declarePaces, Pacing } from './kernel/Pacing.ts'
import { Links } from './links/Links.ts'
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
import { Photos } from './photos/Photos.ts'
import { Outfits } from './outfits/Outfits.ts'

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

/** One wardrobe, one account lifecycle, one capture service, the looks, boards and worn days per isolate, shared
 * by the routes and the processing queue. Assistant-added pieces get the same cut-out providers as the tray. */
const storageServices = (
  bindings: WardrobeBindings & {
    readonly checksQueue: CheckQueue['Service']
    readonly generationQueue: GenerationQueue['Service']
    /** Forget an account's chats with Styld, when it is deleted. */
    readonly forgetChats: (accountId: string) => Effect.Effect<void, unknown>
  },
) =>
  Effect.gen(function* () {
    const modules = yield* socialServices({
      database: bindings.database,
      media: { bucket: bindings.bucket, images: bindings.images },
      checksQueue: bindings.checksQueue,
    })
    const { checks: checksService, looks: looksService, boards: boardsService } = modules
    // A piece whose shown picture changes is checked again while others can see it.
    const pieceChanged = Layer.succeed(PieceChanged, modules.pieceChanged)
    // The wardrobe, captures, My Gallery and generation, each a service from its own layer, over the same database,
    // media and queues; assistant-added pieces get the same cut-out pipeline as the tray.
    const wardrobeModules = Layer.mergeAll(Captures.layer, Photos.layer, Generations.layer).pipe(
      Layer.provideMerge(Wardrobe.layer),
      Layer.provideMerge(pieceCutout(bindings.bucket)),
      Layer.provideMerge(
        Layer.mergeAll(
          Database.layer(bindings.database),
          Media.layer({ bucket: bindings.bucket, images: bindings.images }),
          PieceQueue.layer(bindings.queue),
          GenerationQueue.layer(bindings.generationQueue),
          pieceChanged,
          Layer.succeed(Looks, looksService),
          Layer.succeed(Boards, boardsService),
        ),
      ),
    )
    const {
      wardrobe: wardrobeService,
      captures: capturesService,
      photos: photosService,
      generations: generationsService,
    } = yield* Effect.all({ wardrobe: Wardrobe, captures: Captures, photos: Photos, generations: Generations }).pipe(
      Effect.provide(wardrobeModules),
    )
    const linksService = yield* Links.pipe(
      Effect.provide(Links.layer.pipe(Layer.provide(Layer.succeed(Wardrobe, wardrobeService)))),
    )
    const lifecycleService = yield* makeAccountLifecycle(bindings, bindings.forgetChats)
    return {
      // The credits and the provider-call counter the capture providers were built with, for Styld's replies too.
      holds: yield* Holds,
      metrics: yield* CaptureMetricsService,
      generationsService,
      generations: Layer.succeed(Generations, generationsService),
      curationService: modules.curation,
      discoveryService: modules.discovery,
      discovery: Layer.succeed(Discovery, modules.discovery),
      publicPages: Layer.succeed(PublicPages, modules.publicPages),
      socialService: modules.social,
      social: Layer.succeed(Social, modules.social),
      checksService,
      wardrobeService,
      lifecycleService,
      capturesService,
      looksService,
      boardsService,
      wardrobe: Layer.succeed(Wardrobe, wardrobeService),
      linksService,
      links: Layer.succeed(Links, linksService),
      lifecycle: Layer.succeed(AccountLifecycle, lifecycleService),
      captures: Layer.succeed(Captures, capturesService),
      photosService,
      photos: Layer.succeed(Photos, photosService),
      looks: Layer.succeed(Looks, looksService),
      boards: Layer.succeed(Boards, boardsService),
      worn: Layer.succeed(Worn, modules.worn),
      profilesService: modules.profiles,
      profiles: Layer.succeed(Profiles, modules.profiles),
    }
  }).pipe(Effect.provide(layerCryptoWeb))

/** The services the assistants' tools project. */
const toolServices = (
  services: Effect.Success<ReturnType<typeof storageServices>>,
  outfits: ToolServices['outfits'],
): ToolServices => ({
  wardrobe: services.wardrobeService,
  links: services.linksService,
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
  // Every pace's Workers RateLimit binding (`kernel/Pacing.ts`).
  const paces = yield* declarePaces
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
    paces,
  }
})

/** Clef and the text models over the Worker's `AI` binding. */
const workersAiCalls = (ai: Effect.Success<Effect.Success<typeof declareBindings>['ai']['raw']>): WorkersAiCalls => ({
  // SAFETY: Clef-flash is a Workers AI model newer than the pinned workers-types model list -- the request is the System One API shape Clef.ts builds and documents
  runClef: (request) => ai.run('@cf/cloudflare/clef-flash' as never, request as never),
  // SAFETY: the text models Styld asks are Workers AI chat models outside the pinned workers-types model list -- the input is the Chat Completions body ai/LanguageModel.ts builds
  runModel: (model, input) => ai.run(model as never, input as never),
})

/** Every storage service over the Worker's bindings, on the composition's providers. */
const applicationServices = (
  bindings: Omit<Parameters<typeof storageServices>[0], 'forgetChats'>,
  runtime: {
    readonly origin: string
    readonly stylist: Effect.Success<typeof declareBindings>['stylist']
    readonly pacing: Pacing['Service']
  },
) =>
  Effect.gen(function* () {
    const chatsOf = chatStoreOf(runtime.stylist.objects)
    const services = yield* storageServices({ ...bindings, forgetChats: (accountId) => chatsOf(accountId).erase() })
    const outfitsService = yield* outfitsLive({
      database: bindings.database,
      bindings,
      metrics: services.metrics,
      pace: {
        outfit: (accountId) => runtime.pacing.allows('outfit', accountId),
        thinking: (accountId) => runtime.pacing.allows('thinking', accountId),
      },
    })
    // The assistants' tools, built once: MCP serves them, and Styld answers with them for the account.
    const tools = styldTools(runtime.origin, toolServices(services, outfitsService))
    const stylistService = yield* makeStylistLive({
      chatsOf,
      queue: yield* runtime.stylist.queue.raw,
      tools,
      storage: services,
    })
    return {
      ...services,
      stylistService,
      stylist: Layer.succeed(StylistChats, stylistService),
      outfitsService,
      outfits: Layer.succeed(Outfits, outfitsService),
      tools,
    }
  })

/** Each pace over its binding's runtime object, as a layer and as the service: auth checks its own inside operations
 * that do not carry this request's runtime context. */
const pacingOf = (bindings: Effect.Success<typeof declareBindings>) =>
  Effect.gen(function* () {
    const paces = Pacing.layer(yield* Effect.all(Record.map(bindings.paces, (binding) => binding.raw)))
    return { paces, pacing: yield* Pacing.pipe(Effect.provide(paces)) }
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
      const { paces, pacing } = yield* pacingOf(bindings)
      const allowCodeRequest = (network: string) => pacing.allows('codeRequest', network)
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
        { origin: authOrigin, stylist: bindings.stylist, pacing },
      ).pipe(
        Effect.provide(Layer.mergeAll(providers, Holds.layer, Layer.succeed(CaptureMetricsService, metrics), paces)),
      )
      const { wardrobeService, lifecycleService, capturesService, wardrobe, captures, boards } = services
      const oauth = makeMcpOAuth(db, auth, {
        origin: authOrigin,
        keys: configuration.sessionKeys,
        allowRegistration: (network) => pacing.allows('registration', network),
      })
      const routes = Layer.mergeAll(
        auth.layer,
        apiRoutes(auth, { ...services, pacing: paces }),
        publicImageRoutes.pipe(Layer.provide(Layer.merge(services.publicPages, paces))),
        wardrobeRoutes(auth).pipe(Layer.provide(wardrobe)),
        boardRoutes(auth).pipe(Layer.provide(boards)),
        captureRoutes(auth).pipe(Layer.provide(captures)),
        photoRoutes(auth).pipe(Layer.provide(services.photos)),
        oauth.routes,
        mcpRoutes(
          observabilityBase.release,
          { tools: services.tools, curation: services.curationService, accounts: services.lifecycleService },
          deployment.admins,
        ).pipe(Layer.provide(oauth.server)),
        HttpRouter.add('GET', '/api/health', health(observabilityBase.release)),
        browserTelemetryRoutes(authOrigin, (network) => pacing.allows('telemetry', network)),
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
