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

/** The Workers AI text models Styld asks, each named once here, with its price per token in and out (Workers AI
 * pricing, 31 October). Each task names the one it uses. */
export const textModels = {
  /** Llama 3.3 70B: the mood-board planner. */
  llama70b: { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', input: 0.29, output: 2.25 },
  /** DeepSeek V4.1 Flash: Styld and Thinking. Of five models probed on 31 October it wrote the best Slovenian and
   * called tools reliably. */
  deepSeekFlash: { id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017', input: 0.3, output: 1.2 },
  /** Llama Guard 3: the words of anything public. */
  llamaGuard: { id: '@cf/meta/llama-guard-3-8b', input: 0.48, output: 0.03 },
} as const
export type TextModel = (typeof textModels)[keyof typeof textModels]

/** One text model call's cost. */
export const textCost = (model: TextModel, inputTokens: number, outputTokens: number) =>
  Math.round(inputTokens * model.input + outputTokens * model.output)
