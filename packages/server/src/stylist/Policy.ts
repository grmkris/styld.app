import { Context } from 'effect'

/** How Styld, the stylist in the app, answers (owner, 2026-10-31): on Workers AI through the Worker's binding, through
 * an OpenAI-compatible gateway, or not at all; with which model, at what price a message, and in at most how many
 * model calls a reply. */
export interface StylistPolicy {
  readonly mode: 'workers-ai' | 'gateway' | 'off'
  readonly model: string
  /** The gateway's OpenAI-compatible base address. */
  readonly apiBase: string
  /** Model calls a reply may take, each answering the tools the last one called. */
  readonly maxSteps: number
}

export class StylistConfig extends Context.Service<StylistConfig, StylistPolicy>()('@styld/server/StylistConfig') {}

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.length > 0 ? value : fallback)

/** The model each way answers with unless the Worker names another. On Workers AI, DeepSeek V4.1 Flash ($0.30 a
 * million tokens in, $1.20 out): of five models probed through Styld's own turn on 31 October it wrote the best
 * Slovenian and called tools reliably, as fast as GLM-5.3-flash, whose Slovenian had stray tokens and which once took
 * 30 s a call. Through the Vercel AI Gateway, Claude Haiku 5.5 ($0.10 in, $0.50 out). */
const defaultModels = {
  'workers-ai': '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  gateway: 'anthropic/claude-haiku-5.5',
  off: '',
}

/** The policy from the Worker's environment. Off unless the Worker names a way. */
export const stylistPolicy = (env: Readonly<Record<string, unknown>>): StylistPolicy => {
  const mode = env['STYLIST'] === 'workers-ai' || env['STYLIST'] === 'gateway' ? env['STYLIST'] : 'off'
  return {
    mode,
    model: text(env['STYLIST_MODEL'], defaultModels[mode]),
    apiBase: text(env['STYLIST_GATEWAY_BASE'], 'https://ai-gateway.vercel.sh/v1'),
    maxSteps: 6,
  }
}
