import { Context, Effect, Layer } from 'effect'
import { httpProvider, type HttpProviderSettings } from './Http.ts'
import { busy, outcomeUnknown, refused, type ProviderError } from './Errors.ts'

/** Text completions through Styld's own budgeted LiteLLM key. HTTP failures stay typed all the way to the attempt
 * owner; losing a paid response is unknown, never a reason to send it again. */
export class TextCompletions extends Context.Service<
  TextCompletions,
  {
    readonly run: (model: string, input: Readonly<Record<string, unknown>>) => Effect.Effect<unknown, ProviderError>
  }
>()('@styld/server/providers/TextCompletions') {
  static readonly layer = (run: TextCompletions['Service']['run']) => Layer.succeed(this, { run })
}

/** The live transport; tests supply their fixture Worker's fetch and base. The provider's response body never enters
 * an error or log. */
export const makeTextCompletions = (settings: Omit<HttpProviderSettings, 'provider'>): TextCompletions['Service'] => {
  const http = httpProvider({ ...settings, provider: 'litellm' })
  return TextCompletions.of({
    run: Effect.fn('Styld.Text.complete')(function* (model, input) {
      const response = yield* http.postJson('/chat/completions', { ...input, model, stream: false }, 'unknown')
      if (!response.ok) {
        // A gateway timeout/server failure can follow an upstream completion that was already billed. Only an
        // explicit throttle is safe to retry. Budget/auth/request refusals are final; no body enters the error.
        if (response.status === 429) return yield* busy('litellm')
        if (response.status === 408 || response.status >= 500) return yield* outcomeUnknown('litellm')
        return yield* refused('litellm')
      }
      return yield* http.json(response, 'unknown')
    }),
  })
}
