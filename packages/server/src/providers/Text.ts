import { Context, Effect, Layer, Schema, Stream } from 'effect'
import * as Sse from 'effect/encoding/Sse'
import { httpProvider, type HttpProviderSettings } from './Http.ts'
import { busy, outcomeUnknown, refused, type ProviderError } from './Errors.ts'
import type { TextProvider } from './Costs.ts'

/** Text completions over an OpenAI-compatible API: Styld's own budgeted LiteLLM key, or Meta's API for Styld's chat. HTTP failures stay typed all the way to the attempt
 * owner; losing a paid response is unknown, never a reason to send it again. */
export class TextCompletions extends Context.Service<
  TextCompletions,
  {
    readonly run: (model: string, input: Readonly<Record<string, unknown>>) => Effect.Effect<unknown, ProviderError>
    /** The same request streamed (Server-Sent Events): each chunk's JSON as it arrives, the usage in the last. A
     * stream cut short after it began is unknown: the provider may have billed what it wrote. */
    readonly stream: (model: string, input: Readonly<Record<string, unknown>>) => Stream.Stream<unknown, ProviderError>
  }
>()('@styld/server/providers/TextCompletions') {
  static readonly layer = (service: TextCompletions['Service']) => Layer.succeed(this, service)
}

const decodeChunk = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

/** The live transport for one text provider; tests supply their fixture Worker's fetch and base. The provider's
 * response body never enters an error or log. */
export const makeTextCompletions = (
  settings: Omit<HttpProviderSettings, 'provider'> & { readonly provider: TextProvider },
): TextCompletions['Service'] => {
  const { provider } = settings
  const unknown = () => outcomeUnknown(provider)
  /** An answer that is not ok. A gateway timeout/server failure can follow an upstream completion that was already
   * billed. Only an explicit throttle is safe to retry. Budget/auth/request refusals are final; no body enters the
   * error. */
  const notOk = (status: number) => {
    if (status === 429) return busy(provider)
    if (status === 408 || status >= 500) return unknown()
    return refused(provider)
  }
  const http = httpProvider(settings)
  return TextCompletions.of({
    run: Effect.fn('Styld.Text.complete')(function* (model, input) {
      const response = yield* http.postJson('/chat/completions', { ...input, model, stream: false }, 'unknown')
      if (!response.ok) return yield* Effect.fail(notOk(response.status))
      return yield* http.json(response, 'unknown')
    }),
    stream: (model, input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const response = yield* http.postJson(
            '/chat/completions',
            { ...input, model, stream: true, stream_options: { include_usage: true } },
            'unknown',
          )
          if (!response.ok) return yield* Effect.fail(notOk(response.status))
          const body = response.body
          if (body === null) return yield* Effect.fail(unknown())
          return Stream.fromReadableStream({ evaluate: () => body, onError: unknown }).pipe(
            Stream.decodeText(),
            // @effect-diagnostics-next-line unstableApiUsage:off -- Effect's Server-Sent Events parser reads the streamed completion
            Stream.pipeThroughChannel(Sse.decode()),
            Stream.map(({ data }) => data),
            Stream.takeWhile((data) => data !== '[DONE]'),
            Stream.mapEffect((data) => Effect.mapError(decodeChunk(data), unknown)),
            Stream.catchTags({ Retry: () => Stream.fail(unknown()), SseError: () => Stream.fail(unknown()) }),
          )
        }),
      ),
  })
}
