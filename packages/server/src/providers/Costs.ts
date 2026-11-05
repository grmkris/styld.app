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

/** Alibaba Model Studio paid DeepSeek, through Styld's isolated LiteLLM alias. Singapore/global peak list prices,
 * read 3 November 2026 (model-pricing); estimates deliberately exclude idle-hour and cache discounts. */
export const textModels = {
  deepSeekFlash: { id: 'styld-deepseek-v4.1-flash', input: 0.283, output: 1.131 },
  /** Meta Muse Spark 1.3 Standard (Meta does not train on the prompts) on the same LiteLLM route, for Styld's chat
   * (owner, 5 November 2026). Meta's list price is not read yet: DeepSeek's stands in until it is. */
  museSpark: { id: 'styld-muse-spark-1.3', input: 0.283, output: 1.131 },
} as const
export type TextModel = (typeof textModels)[keyof typeof textModels]

/** One text model call's cost. */
export const textCost = (model: TextModel, inputTokens: number, outputTokens: number) =>
  Math.round(inputTokens * model.input + outputTokens * model.output)
