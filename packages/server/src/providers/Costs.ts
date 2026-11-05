import type { ProviderCall } from '../kernel/Metrics.ts'

// What provider calls cost, in micro-dollars, from list prices: telemetry only (the providers' invoices are the truth;
// what a person pays in credits is protocol `Prices.ts`). Read 2026-10-29 to 31 (`docs/ROADMAP.md` › Provider facts).

export const costs = {
  clefFlashPerToken: 0.038,
  imagesPerTransform: 500,
  samPerImage: 2500,
  samPerFrame: 200,
  /** Muse Image bills a flat $0.01 for each picture it returns (Meta's pricing page, 2026-10-27). */
  musePerImage: 10_000,
  /** Veo 3.1 Lite through the Vercel AI Gateway bills $0.03 a second of video (gateway balance, 30 October). */
  veoLitePerSecond: 30_000,
} as const

/** Who serves a text model: Meta's own OpenAI-compatible API, for every text task since 5 November 2026 (owner). It is
 * the `provider` of every call, error and Analytics Engine row of that model. */
export type TextProvider = Extract<ProviderCall['provider'], 'meta-spark'>

/** One text model: its id at its provider and its list price in micro-dollars a token (dollars a million tokens). */
export interface TextModel {
  readonly id: string
  readonly provider: TextProvider
  readonly input: number
  readonly output: number
}

export const textModels = {
  /** Meta Muse Spark 1.3 Standard (Meta does not train on the prompts), called on Meta's API directly for every text
   * task: Styld's chat, the public-words check, mood-board plans and Thinking (owner, 5 November 2026): $1.25 a million input tokens and $4.25 a million output tokens, no long-context
   * premium; cache reads ($0.15) are not discounted here. Read 5 November 2026 from the published summaries of
   * Meta's Model API price card (TrueFoundry, aicoder.com, tokencost.app agree); Meta's own pricing page
   * (dev.meta.ai) was not reachable then, so check it against the first Meta invoice. */
  museSpark: { id: 'muse-spark-1.3', provider: 'meta-spark', input: 1.25, output: 4.25 },
} as const satisfies Record<string, TextModel>

/** One text model call's cost. */
export const textCost = (model: TextModel, inputTokens: number, outputTokens: number) =>
  Math.round(inputTokens * model.input + outputTokens * model.output)
