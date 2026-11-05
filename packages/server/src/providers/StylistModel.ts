import { Effect, Layer } from 'effect'
import { WorkerEnvironment } from 'effect-cf'
import { type TextTask, textModel } from '../ai/LanguageModel.ts'
import { threadDeploymentOf } from '../Config.ts'
import { analyticsEngine, type AnalyticsDataset, CaptureMetrics } from '../kernel/Metrics.ts'
import type { Fetch } from './Http.ts'
import { metaBase } from './Meta.ts'
import { metaTextCompletions, TextCompletions } from './Text.ts'

// The model Styld's chat answers with, streamed, from its Thread (`stylist/Thread.ts`): Meta Muse Spark on Meta's own
// OpenAI-compatible API (owner, 5 November 2026), through the same text transport as every other text task
// (`ai/LanguageModel.ts`, `Text.ts`), each call deadlined, classified, counted in Analytics Engine as `meta-spark` and
// priced from its streamed usage. The Thread Worker is bound Meta's key (the one SAM and Muse Image use), its stage and
// release (`Config.ts` › `threadDeploymentOf`), and the call dataset, under the API Worker's names.

declare global {
  namespace Cloudflare {
    interface Env {
      readonly AI_CALLS: AnalyticsDataset
    }
  }
}

/** The chat's text task (`stylist/Policy.ts` › `styldModel`) over the Thread Worker's bindings, asking Meta at `base`
 * through `fetch`, as `Live.ts` gives the API Worker's providers theirs. A Worker without its bindings is a broken
 * deployment. */
const stylistModelOver = (task: TextTask, http: { readonly fetch: Fetch; readonly base: string }) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const env = yield* WorkerEnvironment
      const deployment = yield* threadDeploymentOf(env)
      const completions = metaTextCompletions({ base: http.base, key: deployment.metaApiKey, fetch: http.fetch })
      return textModel(task).pipe(
        Layer.provide(TextCompletions.layer(completions)),
        Layer.provide(Layer.succeed(CaptureMetrics, analyticsEngine(env.AI_CALLS, deployment))),
      )
    }),
  )

/** The chat's model on Meta's API. */
export const stylistModel = (task: TextTask) =>
  stylistModelOver(task, { fetch: (input, init) => globalThis.fetch(input, init), base: metaBase })
