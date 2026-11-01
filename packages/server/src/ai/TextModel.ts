import { busy, broken } from '../providers/Errors.ts'
import { Effect, Option, Schema } from 'effect'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import { deadlines, providerCall } from '../providers/Call.ts'
import { chatCost } from '../providers/Costs.ts'

import type { RunChat } from './WorkersAiFetch.ts'

// One text model seam (owner, 2026-10-31): a Workers AI chat model asked for an answer of a given JSON shape, as
// mood boards, Thinking's outfits and trip plans ask it. One call, within the patience Styld keeps for its own calls,
// counted with its tokens' cost. What it is sent and answers is never logged.

export interface TextMessage {
  readonly role: 'system' | 'user'
  readonly content: string
}

export interface StructuredRequest<A> {
  readonly model: string
  readonly kind: 'plan' | 'propose'
  readonly messages: ReadonlyArray<TextMessage>
  /** The answer's JSON schema, sent as the response format. */
  readonly schema: object
  readonly answer: Schema.Decoder<A>
}

const Usage = Schema.Struct({
  prompt_tokens: Schema.optionalKey(Schema.Number),
  completion_tokens: Schema.optionalKey(Schema.Number),
})

/** Workers AI answers older models' calls with `response`, newer ones' as a Chat Completion. */
const Output = Schema.Struct({
  response: Schema.optionalKey(Schema.Unknown),
  choices: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ message: Schema.Struct({ content: Schema.optionalKey(Schema.NullOr(Schema.String)) }) }),
    ),
  ),
  usage: Schema.optionalKey(Usage),
})
type Output = typeof Output.Type

const failed = () => busy('workers-ai')
const unreadable = () => broken('workers-ai')

/** The JSON text of an answer, without the code fence some models put around it. */
const unfenced = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '')

/** The answer's JSON: an object as given, or parsed from its text. */
const answerJson = (output: Output): Option.Option<unknown> => {
  const content = output.choices?.[0]?.message.content ?? output.response
  if (typeof content !== 'string') return Option.fromNullishOr(content)
  return Option.liftThrowable((text: string): unknown => JSON.parse(text))(unfenced(content))
}

const costOf = (model: string, output: Output) => {
  const input = output.usage?.prompt_tokens ?? 0
  const outputTokens = output.usage?.completion_tokens ?? 0
  return { units: input + outputTokens, costMicroUsd: chatCost(model, input, outputTokens) }
}

/** Ask a Workers AI chat model for an answer of the request's shape: the answer and what it cost, or a failure when
 * it did not answer in time or answered something else. */
export const structured = <A>(run: RunChat, metrics: CaptureMetrics['Service'], request: StructuredRequest<A>) =>
  providerCall(
    metrics,
    { provider: 'workers-ai', model: request.model, kind: request.kind, deadline: deadlines.chat, replaySafe: true },
    Effect.tryPromise({
      try: () =>
        run(request.model, {
          messages: request.messages.map((message) => ({ ...message })),
          response_format: { type: 'json_schema', json_schema: request.schema },
        }),
      catch: failed,
    }).pipe(
      Effect.flatMap((raw) => Schema.decodeUnknownEffect(Output)(raw).pipe(Effect.mapError(unreadable))),
      Effect.flatMap((output) =>
        Option.match(answerJson(output), {
          onNone: () => Effect.fail(unreadable()),
          onSome: (json) =>
            Schema.decodeUnknownEffect(request.answer)(json).pipe(
              Effect.mapError(unreadable),
              Effect.map((answer) => ({ answer, ...costOf(request.model, output) })),
            ),
        }),
      ),
    ),
    ({ units, costMicroUsd }) => ({ units, costMicroUsd }),
  )
