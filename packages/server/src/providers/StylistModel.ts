import { Config, Effect, Layer } from 'effect'
import { WorkerEnvironment } from 'effect-cf'
import { textModel } from '../ai/LanguageModel.ts'
import { analyticsEngine, type AnalyticsDataset, CaptureMetrics } from '../kernel/Metrics.ts'
import { styldModel } from '../stylist/Policy.ts'
import { metaBase } from './Meta.ts'
import { makeTextCompletions, TextCompletions } from './Text.ts'

// The model Styld's chat answers with, streamed, from its Thread (`stylist/Thread.ts`): Meta Muse Spark on Meta's own
// OpenAI-compatible API (owner, 5 November 2026), through the same text transport as every other text task
// (`ai/LanguageModel.ts`, `Text.ts`), each call deadlined, classified, counted in Analytics Engine and priced from its
// streamed usage. The Thread Worker is bound Meta's key (the one SAM and Muse Image use), its stage and release, and
// the call dataset, under the API Worker's names.

declare global {
  namespace Cloudflare {
    interface Env {
      readonly AI_CALLS: AnalyticsDataset
    }
  }
}

/** Styld's chat model over the Thread Worker's bindings. A Worker without them is a broken deployment. */
export const stylistModel = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* WorkerEnvironment
    const settings = yield* Config.all({
      key: Config.Redacted('META_API_KEY'),
      environment: Config.String('STYLD_ENV'),
      release: Config.String('STYLD_RELEASE'),
    })
    const completions = makeTextCompletions({
      base: `${metaBase}/v1`,
      key: settings.key,
      fetch: (input, init) => globalThis.fetch(input, init),
    })
    return textModel(styldModel).pipe(
      Layer.provide(TextCompletions.layer(completions)),
      Layer.provide(Layer.succeed(CaptureMetrics, analyticsEngine(env.AI_CALLS, settings))),
    )
  }),
).pipe(Layer.orDie)
