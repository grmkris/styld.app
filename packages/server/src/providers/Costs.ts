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

/** Workers AI chat models, per token in and out (Workers AI pricing, 31 October). */
const chatPrices: Readonly<Record<string, { readonly input: number; readonly output: number }>> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 0.29, output: 2.25 },
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': { input: 0.3, output: 1.2 },
}

/** One chat call's cost; a model without a listed price is priced as DeepSeek V4.1 Flash. */
export const chatCost = (model: string, inputTokens: number, outputTokens: number) => {
  const price = chatPrices[model] ?? { input: 0.3, output: 1.2 }
  return Math.round(inputTokens * price.input + outputTokens * price.output)
}
