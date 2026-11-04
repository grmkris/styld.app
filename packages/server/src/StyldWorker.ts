import * as Cloudflare from '@alchemy.run/cloudflare'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect, Layer } from 'effect'
import * as UrlParams from 'effect/http/UrlParams'
import { declareBindings } from './Bindings.ts'
import { DomainLive } from './DomainLive.ts'
import type { ProvidersFor } from './providers/Live.ts'

// The API Worker's entry: its runtime, its bindings and its deployment. Everything else, the application of
// `Application.ts` and the live providers, is imported on the Worker's first event rather than at startup, where
// Cloudflare limits the CPU a script's top level may take (`ScriptStartupError`, 4 November 2026): the whole module
// graph evaluated there took about a second. Alchemy builds a Worker's init once per isolate, shared by every event
// and retried after a failure, so the import runs once.

/** The Cloudflare and Domain services the API Worker runs on. */
export const Runtime = Layer.mergeAll(
  // The Worker instance is the runtime context its init runs in; the application, built on the first request, keeps
  // it for the isolate (`onFirstUse`).
  Layer.effect(RuntimeContext, Cloudflare.Worker),
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
  // Traces record request URLs; upload paths carry a one-time token in `token`, and signed media paths carry
  // bearer-capability material in every query parameter. Preserve Effect's built-in provider redactions.
  Layer.succeed(UrlParams.CurrentRedactedNames, [
    ...UrlParams.CurrentRedactedNames.defaultValue(),
    'token',
    'a',
    'k',
    't',
    'v',
    'e',
    's',
  ]),
)

export class StyldWorker extends Cloudflare.Worker<StyldWorker, Cloudflare.WorkerShape>()('StyldWorker') {}

/** How the API Worker is deployed, from the module that is its entry. */
export const workerOptions = (main: string) => ({
  main,
  // Keep local workerd and deployed Workers on the same supported date; telemetry needs >= 2026-07-28.
  compatibility: { date: '2026-10-19' },
  workersDev: { enabled: false, previewsEnabled: false },
  observability: {
    enabled: true,
    redactQueryString: true,
    logs: { enabled: true, invocationLogs: true },
    traces: { enabled: true, headSamplingRate: 1 },
  },
})

/** The API Worker's program on a composition's providers, run on `Runtime`: the Worker's own are the live ones (below);
 * the native suite runs it on its fakes (`test/NativeWorker.ts`). */
export const styldProgram = (providersFor: ProvidersFor) =>
  Effect.gen(function* () {
    const bindings = yield* declareBindings
    const { serve } = yield* Effect.promise(() => import('./Application.ts'))
    return yield* serve(bindings, providersFor)
  })

/** The live providers, imported when the application is first built. */
const liveProviders: ProvidersFor = (bindings) =>
  Layer.unwrap(
    Effect.promise(() => import('./providers/Live.ts')).pipe(Effect.map((live) => live.liveProviders(bindings))),
  )

export default StyldWorker.make(
  workerOptions(import.meta.url),
  styldProgram(liveProviders).pipe(Effect.provide(Runtime)),
)
