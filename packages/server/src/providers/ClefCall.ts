import { Effect, Option, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import type { Picture } from '../capture/Providers.ts'
import type { CaptureMetrics } from '../kernel/Metrics.ts'
import { deadlines, providerCall } from './Call.ts'
import { costs } from './Costs.ts'
import { broken, busy, refused } from './Errors.ts'

// How Styld asks Clef-flash (Workers AI) anything, as the provider seam every module shares: the request, the binding
// narrowed to it, one counted call with its tokens' cost, and how its answers read. What Clef is asked about garments
// is the adapter's (`Clef.ts`); the outfit and content judges ask through this too.

/** A Clef-flash request (Workers AI `@cf/cloudflare/clef-flash`, the System One API). A type, not an interface: Workers
 * AI takes it as the plain record its unlisted models are sent. */
export type ClefRequest = {
  readonly model: 'clef-flash'
  readonly state: string
  readonly images: ReadonlyArray<{ readonly content_type: string; readonly base64: string }>
  readonly questions: Readonly<Record<string, object>>
}

/** The Workers AI binding narrowed to Clef-flash. */
export type RunClef = (request: ClefRequest) => Promise<unknown>

/** Clef-flash's Workers AI model, newer than the pinned workers-types model list: the binding takes it as an unlisted
 * model, whose answer `askClef` decodes. */
const clefModel = '@cf/cloudflare/clef-flash'

/** Clef over the Worker's `AI` binding. */
export const clefOver =
  (ai: Ai): RunClef =>
  (request) =>
    ai.run(clefModel, request)

const Choice = Schema.Struct({ choice: Schema.String, probabilities: Schema.Record(Schema.String, Schema.Number) })
const Noul = Schema.Struct({ noul: Schema.Number })
const Answer = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.Unknown),
  usage: Schema.optionalKey(Schema.Struct({ input_tokens: Schema.optionalKey(Schema.Number) })),
})
export type ClefAnswer = typeof Answer.Type

const failed = (retryable: boolean, cause?: unknown) => (retryable ? busy('clef', cause) : refused('clef', cause))

/** A picture as Clef reads it. */
export const imageOf = (picture: Picture) => ({
  content_type: picture.contentType,
  base64: Base64.encode(picture.bytes),
})

/** A choice question's answer, if it has one. */
export const choiceOf = (answer: ClefAnswer, id: string) =>
  Option.flatMap(Option.fromNullishOr(answer.answers[id]), Schema.decodeUnknownOption(Choice))
/** A yes-or-no answer's likelihood of yes, 0 when it is missing. */
export const noulOf = (answer: ClefAnswer, id: string) =>
  Option.match(Option.flatMap(Option.fromNullishOr(answer.answers[id]), Schema.decodeUnknownOption(Noul)), {
    onNone: () => 0,
    onSome: ({ noul }) => noul,
  })

/** What one answer cost: its input tokens, at Clef-flash's list price. */
export const clefCost = (answer: ClefAnswer) => {
  const tokens = answer.usage?.input_tokens ?? 0
  return { units: tokens, costMicroUsd: Math.round(tokens * costs.clefFlashPerToken) }
}

/** Ask Clef, counted as one provider call of `kind` with its tokens' cost. */
export const askClef = (
  run: RunClef,
  metrics: CaptureMetrics['Service'],
  kind: 'route' | 'suggest' | 'check' | 'judge' | 'compare' | 'match' | 'outfit',
  request: ClefRequest,
) =>
  providerCall(
    metrics,
    { provider: 'clef', model: 'clef-flash', kind, deadline: deadlines.clef, replaySafe: true },
    Effect.tryPromise({ try: () => run(request), catch: (cause) => failed(true, cause) }).pipe(
      Effect.flatMap((raw) => Schema.decodeUnknownEffect(Answer)(raw).pipe(Effect.mapError(() => broken('clef')))),
    ),
    clefCost,
  )
