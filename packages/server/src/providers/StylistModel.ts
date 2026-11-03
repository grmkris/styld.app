import * as OpenAiClient from '@effect/ai-openai-compat/OpenAiClient'
import * as OpenAiLanguageModel from '@effect/ai-openai-compat/OpenAiLanguageModel'
import { Config, Layer } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { stylistModelName } from '../stylist/Agent.ts'

// The model Styld's chat answers with, streamed, from its Thread (`stylist/Thread.ts`): DeepSeek V4.1 Flash through
// Styld's own budgeted LiteLLM route (owner, 3 November 2026), over Effect's OpenAI-compatible client. The Thread
// Worker is bound the route's address and key under the names the API Worker uses for the same route.

/** Styld's chat model over the Thread Worker's `STYLD_LITELLM_URL` and `STYLD_LITELLM_KEY`. */
// @effect-diagnostics-next-line unstableApiUsage:off -- Effect's OpenAI-compatible model is the chat's streaming client
export const stylistModel = OpenAiLanguageModel.layer({ model: stylistModelName }).pipe(
  Layer.provide(
    // @effect-diagnostics-next-line unstableApiUsage:off -- the OpenAI-compatible client reads the route's address and key once
    OpenAiClient.layerConfig({
      apiUrl: Config.String('STYLD_LITELLM_URL'),
      apiKey: Config.Redacted('STYLD_LITELLM_KEY'),
    }),
  ),
  Layer.provide(FetchHttpClient.layer),
)
