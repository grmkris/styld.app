import { provideAllCatalogs } from '@styld/i18n/all'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { ProofDispatchSink } from '@styld/auth'
import { Proofs } from '@yielded/auth'
import type { HttpBodyError } from 'effect/http/HttpBody'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import * as WebCrypto from '@yielded/auth/WebCrypto'
import { Context, Effect, Layer, Logger, Record } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@styld/observability'
import { apiRoutes } from './Api.ts'
import { Auth, makeAuthHttp, withCodeRequestPolicy } from './AuthHttp.ts'
import { authOptions } from './AuthConfiguration.ts'
import type { Bindings } from './Bindings.ts'
import { Deployment, deploymentOf, stylistThreadsOf } from './Config.ts'
import { GenerationQueue } from './generation/Queue.ts'
import { ImportQueue } from './imports/Queue.ts'
import { onFirstUse } from './IsolateCache.ts'
import type { Consumer, Delivering } from './jobs/Jobs.ts'
import { runSweeps, type Sweep } from './jobs/Sweeps.ts'
import { Database } from './kernel/Db.ts'
import { Media } from './kernel/Media.ts'
import { SignedMedia } from './kernel/SignedMedia.ts'
import { analyticsEngine, CaptureMetrics } from './kernel/Metrics.ts'
import type { ConsumerUsesOf, SweepUsesOf } from './kernel/Module.ts'
import { Pacing } from './kernel/Pacing.ts'
import { modules } from './Modules.ts'
import type { ProvidersFor, WorkersAiCalls } from './providers/Live.ts'
import { emailSender } from './Resources.ts'
import { CheckQueue } from './safety/Checks.ts'
import { StylistChats } from './stylist/Service.ts'
import type { Settled, ToolRequest } from './stylist/Agent.ts'
import { StylistThreads } from './stylist/Threads.ts'
import { PaidAttempts } from './usage/Attempts.ts'
import { Holds } from './usage/Holds.ts'
import { PieceQueue } from './wardrobe/Processing.ts'

// The API Worker's application: the kernel (database, media, queues, credits, pacing, the counter, auth, the
// deployment and the providers) built once per runtime over the Worker's bindings, and every module of `Modules.ts`
// over it: their services, typed API groups and routes, the queues they consume and the sweeps they run.
// `StyldWorker.ts` imports this module on the Worker's first event, not at startup: evaluating the whole module graph
// at the top level took Cloudflare's startup CPU limit (4 November 2026).

// The server formats in every language: page renders and code emails.
provideAllCatalogs()

// Alchemy's Worker bridge gives every event `Logger.consolePretty`, which reaches Workers Logs
// as one string. Requests log structured objects instead, so Workers Logs indexes every field.
const structuredLogs: ReadonlySet<Logger.Logger<unknown, unknown>> = new Set([Logger.consoleStructured])

/** Clef over the Worker's `AI` binding. */
const workersAiCalls = (ai: Effect.Success<Bindings['ai']['raw']>): WorkersAiCalls => ({
  // SAFETY: Clef-flash is a Workers AI model newer than the pinned workers-types model list -- the request is the System One API shape Clef.ts builds and documents
  runClef: (request) => ai.run('@cf/cloudflare/clef-flash' as never, request as never),
})

/** What every module is built over, once per runtime: the Worker's bindings as services, credits, pacing, the call
 * counter, auth, the deployment and the composition's providers. */
const kernelOf = (bindings: Bindings, providersFor: ProvidersFor, env: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const deployment = yield* deploymentOf(env)
    const observabilityBase = yield* makeObservabilityBase({
      environment: deployment.environment,
      release: deployment.release,
      component: 'server',
    }).pipe(Effect.orDie)
    const metrics = analyticsEngine(yield* bindings.calls.raw, observabilityBase)
    const bucket = yield* bindings.media.raw
    const images = yield* bindings.images.raw
    const workersAi = workersAiCalls(yield* bindings.ai.raw)
    const auth = makeAuthHttp(bindings.database, authOptions(deployment.auth, yield* bindings.email.raw, emailSender))
    const writers = bindings.writers
    const database = Database.layer(yield* bindings.database.raw)
    const holds = Holds.layer.pipe(Layer.provide(database))
    const kernel = Layer.mergeAll(
      providersFor({ workersAi, images, bucket, metrics, deployment, env }),
      holds,
      PaidAttempts.layer.pipe(Layer.provide(Layer.merge(holds, database))),
      Pacing.layer(yield* Effect.all(Record.map(bindings.paces, (binding) => binding.raw))),
      database,
      Media.layer({ bucket, images }),
      SignedMedia.layer(deployment.auth.secret),
      PieceQueue.layer(yield* writers.pieces.raw),
      CheckQueue.layer(yield* writers.checks.raw),
      GenerationQueue.layer(yield* writers.generation.raw),
      ImportQueue.layer(yield* writers.imports.raw),
      StylistThreads.layer(yield* stylistThreadsOf(env)),
      Layer.succeed(CaptureMetrics, metrics),
      Layer.succeed(Auth, auth),
      Layer.succeed(Deployment, deployment),
      WebCrypto.layer,
    )
    return { kernel, auth, observabilityBase }
  })

const [first, ...rest] = modules

/** Every module's services over the kernel; a module provides the modules it uses itself, built once. */
const servicesOver = <K, E, R>(kernel: Layer.Layer<K, E, R>) =>
  Layer.mergeAll(first.layer, ...rest.map(({ layer }) => layer)).pipe(Layer.provideMerge(kernel))

/** What the application consists of, beyond its services: every module's API groups, routes, consumers and sweeps. */
type AnyModule = (typeof modules)[number]
const parts = {
  api: modules.flatMap(({ api }) => (api === undefined ? [] : [api])),
  routes: modules.flatMap(({ routes }) => (routes === undefined ? [] : [routes])),
  consumers: modules.flatMap(({ consumers }): ReadonlyArray<Consumer<ConsumerUsesOf<AnyModule>>> => consumers ?? []),
  sweeps: modules.flatMap(({ sweeps }): ReadonlyArray<Sweep<SweepUsesOf<AnyModule>>> => sweeps ?? []),
}

/** Two types each assignable to the other: a requirement compared by identity, not by shape (service tags of
 * different services can be assignable one way). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** What the Worker's runtime gives the application's services: the Wallet aggregate (`Holds`) and the runtime
 * context. */
type RuntimeServices = Exclude<Layer.Services<typeof Holds.layer>, Database> | RuntimeContext

/** What the HTTP handler leaves to each request: the router `toHttpEffect` provides, the code-request limiter
 * (`withCodeRequestPolicy`) and the body error a route may answer. */
type RequestServices =
  | RuntimeServices
  | HttpRouter.HttpRouter
  | HttpRouter.Request<'Error', HttpBodyError>
  | HttpRouter.Request<'Requires', Proofs.HostIngressLimiter>

type SameAsOneOf<R, Allowed> = Allowed extends unknown ? Same<R, Allowed> : never
/** The requirements of `R` that are not among `Allowed`, compared by identity. */
type Unexpected<R, Allowed> = R extends unknown ? (true extends SameAsOneOf<R, Allowed> ? never : R) : never

/** A layer checked to need nothing but `Allowed`: a module whose layer or routes need a service no kernel layer or
 * module provides is a type error here, not a missing service on the first request. */
const closed =
  <Allowed>() =>
  <K, E, R>(
    layer: Layer.Layer<K, E, R> &
      ([Unexpected<R, Allowed>] extends [never] ? unknown : { readonly unprovided: Unexpected<R, Allowed> }),
  ) =>
    layer

/** The application over the Worker's bindings, built from the request runtime's environment: every service once, and
 * the HTTP handler over them. */
const makeApplication =
  (bindings: Bindings, providersFor: ProvidersFor) => (env: Cloudflare.Workers.WorkerEnvironment['Service']) =>
    Effect.gen(function* () {
      const { kernel, auth, observabilityBase } = yield* kernelOf(bindings, providersFor, env)
      // A module that cannot be built is a broken deployment.
      const context = yield* Layer.build(closed<RuntimeServices>()(servicesOver(kernel))).pipe(Effect.orDie)
      const routes = Layer.mergeAll(apiRoutes(auth, Layer.mergeAll(Layer.empty, ...parts.api)), ...parts.routes).pipe(
        Layer.provide(Layer.succeedContext(context)),
        Layer.provide(AlchemyHttp.Platform),
      )
      const pacing = Context.get(context, Pacing)
      return {
        handle: yield* HttpRouter.toHttpEffect(closed<RequestServices>()(routes)).pipe(Effect.orDie),
        context,
        observabilityBase,
        allowCodeRequest: (network: string) => pacing.allows('codeRequest', network),
      }
    })

type Application = Effect.Success<ReturnType<ReturnType<typeof makeApplication>>>
type ApplicationServices = Application['context'] extends Context.Context<infer Services> ? Services : never

/** The API Worker's events over its declared bindings and a composition's providers: the HTTP handler, the queues'
 * consumers and the sweeps' cron, declared in the Worker's init, and the Thread Worker's calls. */
export const serve = (bindings: Bindings, providersFor: ProvidersFor) =>
  Effect.gen(function* () {
    // Bindings configured by the stack (including the web origin and secrets)
    // exist only in the deployed request runtime, not while Alchemy evaluates
    // the Worker declaration during planning. Build the application on the
    // first request and reuse it for every later request in this isolate.
    const application = yield* onFirstUse(makeApplication(bindings, providersFor))
    const current = Effect.flatMap(Cloudflare.Workers.WorkerEnvironment, application)
    const fetch = Effect.gen(function* () {
      const { handle, observabilityBase, allowCodeRequest } = yield* current
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
    /** A delivery's work, with the application its first delivery built. */
    const delivering: Delivering<ApplicationServices> = (work) =>
      Effect.flatMap(current, ({ context, observabilityBase }) =>
        work(observabilityBase).pipe(Effect.provide(context)),
      ).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs))
    yield* Effect.forEach(parts.consumers, (consumer) => consumer.declare(bindings.queues[consumer.name], delivering), {
      discard: true,
    })
    // Every ten minutes, every sweep on its own (`jobs/Sweeps.ts`): nothing stays pending forever.
    yield* Cloudflare.Workers.cron('*/10 * * * *', () =>
      Effect.flatMap(current, ({ context, observabilityBase }) =>
        runSweeps(parts.sweeps.map(({ name, run }) => ({ name, run: Effect.provide(run, context) }))).pipe(
          withObservability('styld.cron', { ...observabilityBase, kind: 'cron.sweep' }),
        ),
      ).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs)),
    )
    /** A call from a chat's Thread over the Thread Worker's service binding, with the application its first event
     * built. A failure is a defect: the Thread sees the call fail and tries again. */
    const fromThread = <A, E>(kind: string, call: (stylist: StylistChats['Service']) => Effect.Effect<A, E>) =>
      Effect.flatMap(current, ({ context, observabilityBase }) =>
        Effect.flatMap(StylistChats, call).pipe(
          Effect.provide(context),
          Effect.orDie,
          withObservability('styld.rpc', { ...observabilityBase, kind }),
        ),
      ).pipe(Effect.provideService(Logger.CurrentLoggers, structuredLogs))
    return {
      fetch,
      /** A tool call of a chat's Thread (`stylist/Thread.ts`), run for the Thread's account. */
      stylistTool: (request: ToolRequest) => fromThread('rpc.stylist.tool', (stylist) => stylist.tool(request)),
      /** A reply ended in its Thread: its credit is settled once. */
      stylistSettled: (settled: Settled) => fromThread('rpc.stylist.settled', (stylist) => stylist.settle(settled)),
    }
  })
