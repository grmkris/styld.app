import { type Duration, Effect, Layer, Predicate, Schema, Stream } from 'effect'
import { AiError, LanguageModel, Prompt, type Response, Tool } from 'effect/ai'
import { toCodecOpenAI } from 'effect/ai/OpenAiStructuredOutput'
import { CaptureMetrics, type ProviderCall } from '../kernel/Metrics.ts'
import { providerCall } from '../providers/Call.ts'
import { type TextModel, textCost } from '../providers/Costs.ts'
import { busy, outcomeUnknown, type ProviderError, refused } from '../providers/Errors.ts'
import { TextCompletions } from '../providers/Text.ts'

// Every text task uses Effect's LanguageModel over Styld's paid LiteLLM route. Clef keeps the Workers AI binding.
// Objects are requested as JSON with an explicit schema in the prompt and decoded by Effect: DeepSeek supports
// JSON Object mode, rather than provider-enforced JSON Schema. Replies are buffered as before; neither prompts,
// answers nor reasoning are logged.

/** One text task: the model it asks, what its calls are counted as, and how long one call may take. */
export interface TextTask {
  readonly model: TextModel
  readonly kind: ProviderCall['kind']
  readonly deadline: Duration.Input
  readonly maxTokens: number
}

const provider = 'litellm'

const TokenCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Usage = Schema.Struct({
  prompt_tokens: TokenCount,
  completion_tokens: TokenCount,
  prompt_tokens_details: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ cached_tokens: Schema.optionalKey(Schema.NullOr(TokenCount)) })),
  ),
  completion_tokens_details: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ reasoning_tokens: Schema.optionalKey(Schema.NullOr(TokenCount)) })),
  ),
})

const ToolCall = Schema.Struct({
  id: Schema.NonEmptyString,
  function: Schema.Struct({ name: Schema.NonEmptyString, arguments: Schema.String }),
})

/** An empty answer or absent usage is a protocol failure, never a free successful call. */
const Output = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.optionalKey(Schema.NullOr(Schema.String)),
        tool_calls: Schema.optionalKey(Schema.NullOr(Schema.Array(ToolCall))),
      }),
      finish_reason: Schema.String,
    }),
  ),
  usage: Usage,
}).check(
  Schema.makeFilter((output) => {
    const first = output.choices[0]
    return (
      first !== undefined && ((first.message.content ?? '').length > 0 || (first.message.tool_calls ?? []).length > 0)
    )
  }),
)
type Output = typeof Output.Type

/** How a provider failure reads as an `AiError`, and back: one mapping each way, so a caller of the language model
 * handles the same `ProviderError` reasons as any other provider call. */
const aiErrorOf = (method: string) => (error: ProviderError) =>
  AiError.make({
    module: 'StyldText',
    method,
    reason: Predicate.isTagged(error.reason, 'Broken')
      ? new AiError.InvalidOutputError({ description: 'The text provider answered something unreadable' })
      : Predicate.isTagged(error.reason, 'Refused')
        ? new AiError.InvalidRequestError({ description: 'The text provider refused the request' })
        : Predicate.isTagged(error.reason, 'OutcomeUnknown')
          ? new AiError.UnknownError({ description: 'The text provider may have answered' })
          : new AiError.InternalProviderError({ description: 'The text provider did not answer in time' }),
  })

const readingFailures = [
  'InvalidOutputError',
  'StructuredOutputError',
  'InvalidResponseError',
  'ToolParameterValidationError',
  'ToolNotFoundError',
  'UnsupportedSchemaError',
] as const
const refusals = ['InvalidRequestError', 'ContentPolicyError', 'InvalidUserInputError'] as const

/** A language model's failure as the provider failure it is: an answer Styld cannot read is Broken (the same request
 * reads the same way), a refusal Refused, a lost answer OutcomeUnknown, anything else Busy. */
export const providerErrorOf = (error: AiError.AiError): ProviderError => {
  const is = (tags: ReadonlyArray<string>) => tags.some((tag) => Predicate.isTagged(error.reason, tag))
  // A paid gateway can have billed a completion before returning malformed JSON or a schema mismatch. Keep that
  // outcome claimed so a caller cannot pay for the same request again while trying to read it.
  if (is(readingFailures)) return outcomeUnknown(provider)
  if (is(refusals)) return refused(provider)
  return is(['UnknownError']) ? outcomeUnknown(provider) : busy(provider)
}

/** The JSON text of an answer, without the code fence some models put around it. */
const unfenced = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '')

/** The prompt as Chat Completions messages. Styld sends only words, so a file in it is a request The text provider cannot
 * take. */
const messagesOf = (prompt: Prompt.Prompt) =>
  prompt.content.flatMap((message): ReadonlyArray<Readonly<Record<string, unknown>>> => {
    switch (message.role) {
      case 'system':
        return [{ role: 'system', content: message.content }]
      case 'user':
        return [
          { role: 'user', content: message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') },
        ]
      case 'assistant': {
        const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
        const calls = message.content.flatMap((part) =>
          part.type === 'tool-call' && !part.providerExecuted
            ? [{ id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.params) } }]
            : [],
        )
        return [{ role: 'assistant', content: text, ...(calls.length > 0 ? { tool_calls: calls } : {}) }]
      }
      case 'tool':
        return message.content.flatMap((part) =>
          part.type === 'tool-result'
            ? [
                {
                  role: 'tool',
                  tool_call_id: part.id,
                  content:
                    part.modelOutput === undefined
                      ? typeof part.result === 'string'
                        ? part.result
                        : JSON.stringify(part.result)
                      : Prompt.toolModelOutputToText(part.modelOutput),
                },
              ]
            : [],
        )
    }
  })

/** A tool's name: every tool has one, whatever its type says. */
const nameOf = (tool: { readonly name: string }) => tool.name

/** The tools, as Chat Completions functions, and how the model may choose among them. */
const toolsOf = (options: LanguageModel.ProviderOptions) => {
  if (options.tools.length === 0) return {}
  const tools = options.tools.map((tool) => ({
    type: 'function',
    function: {
      name: nameOf(tool),
      ...(Tool.getDescription(tool) === undefined ? {} : { description: Tool.getDescription(tool) }),
      // Tool arguments are function parameters, not provider-enforced structured output. Keep Effect's ordinary
      // object schema here; the OpenAI transformer rejects an empty object tool schema as a non-object `not null`.
      parameters: Tool.getJsonSchema(tool),
    },
  }))
  const choice: LanguageModel.ToolChoice<string> = options.toolChoice
  const toolChoice =
    typeof choice === 'string'
      ? choice
      : namesTool(choice)
        ? { type: 'function', function: { name: choice.tool } }
        : choice.mode === 'required'
          ? 'required'
          : 'auto'
  return { tools, tool_choice: toolChoice }
}

/** Whether a tool choice names one tool, rather than a mode. */
function namesTool(choice: Exclude<LanguageModel.ToolChoice<string>, string>): choice is { readonly tool: string } {
  return Predicate.hasProperty(choice, 'tool')
}

/** JSON Object mode promises JSON syntax; Effect still enforces the requested schema before a caller can use it. */
const requestOf = (task: TextTask, options: LanguageModel.ProviderOptions) =>
  Effect.try({
    try: (): Readonly<Record<string, unknown>> => {
      const messages = messagesOf(options.prompt)
      if (options.responseFormat.type === 'json') {
        const schema = Tool.getJsonSchemaFromSchema(options.responseFormat.schema, { transformer: toCodecOpenAI })
        messages.unshift({
          role: 'system',
          content: `Return only a JSON object matching this JSON schema: ${JSON.stringify(schema)}`,
        })
      }
      return {
        messages,
        ...toolsOf(options),
        max_tokens: task.maxTokens,
        reasoning_effort: 'none',
        ...(options.responseFormat.type === 'json' ? { response_format: { type: 'json_object' } } : {}),
      }
    },
    catch: () => refused(provider),
  })

const finishOf = (reason: string | null | undefined, called: boolean): Response.FinishPartEncoded['reason'] => {
  if (reason === 'length') return 'length'
  if (reason === 'content_filter') return 'content-filter'
  if (reason === 'tool_calls' || (reason === 'stop' && called)) return 'tool-calls'
  return reason === 'stop' ? 'stop' : 'unknown'
}

/** Words without the model's reasoning: a reasoning model's thoughts come in `reasoning_content`, which is never read,
 * or in its words between `<think>` tags, or before a lone `</think>` when the opening tag was in the prompt's
 * template. None of it is the answer. */
const withoutReasoning = (text: string) =>
  text
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gu, '')
    .replace(/^[\s\S]*<\/think>/u, '')
    .trimStart()

/** The answer's words, excluding reasoning. */
const textOf = (output: Output, json: boolean) => {
  const text = withoutReasoning(output.choices[0]?.message.content ?? '')
  return json ? unfenced(text) : text
}

const paramsOf = (call: typeof ToolCall.Type) =>
  Effect.try({
    try: () => Tool.unsafeSecureJsonParse(call.function.arguments),
    catch: () => outcomeUnknown(provider),
  })

/** The answer as response parts: its words, its tool calls and its finish with the tokens billed. */
const partsOf = Effect.fnUntraced(function* (output: Output, json: boolean) {
  const choice = output.choices?.[0]
  const calls = choice?.message.tool_calls ?? []
  const text = textOf(output, json)
  const toolCalls = yield* Effect.forEach(calls, (call) =>
    Effect.map(paramsOf(call), (params): Response.PartEncoded => ({
      type: 'tool-call',
      id: call.id,
      name: call.function.name,
      params,
    })),
  )
  const input = output.usage.prompt_tokens
  const written = output.usage.completion_tokens
  const finish: Response.PartEncoded = {
    type: 'finish',
    reason: finishOf(choice?.finish_reason, toolCalls.length > 0),
    usage: {
      inputTokens: {
        uncached: input - (output.usage.prompt_tokens_details?.cached_tokens ?? 0),
        total: input,
        cacheRead: output.usage.prompt_tokens_details?.cached_tokens ?? undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: written,
        text: written - (output.usage.completion_tokens_details?.reasoning_tokens ?? 0),
        reasoning: output.usage.completion_tokens_details?.reasoning_tokens ?? undefined,
      },
    },
  }
  return [...(text.length > 0 ? [{ type: 'text' as const, text }] : []), ...toolCalls, finish]
})

/** The same parts as a stream: the words as one delta. */
const streamed = (parts: ReadonlyArray<Response.PartEncoded>): ReadonlyArray<Response.StreamPartEncoded> =>
  parts.flatMap((part): ReadonlyArray<Response.StreamPartEncoded> => {
    if (part.type !== 'text') return part.type === 'tool-call' || part.type === 'finish' ? [part] : []
    return [
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: part.text },
      { type: 'text-end', id: 'text' },
    ]
  })

/** One counted call of the task's model. */
const ask = (task: TextTask, run: TextCompletions['Service']['run'], metrics: CaptureMetrics['Service']) =>
  Effect.fnUntraced(function* (options: LanguageModel.ProviderOptions) {
    const request = yield* requestOf(task, options)
    return yield* providerCall(
      metrics,
      { provider, model: task.model.id, kind: task.kind, deadline: task.deadline, replaySafe: false },
      run(task.model.id, request).pipe(
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(Output)(raw).pipe(Effect.mapError(() => outcomeUnknown(provider))),
        ),
        Effect.flatMap((output) =>
          options.responseFormat.type === 'json' && output.choices[0]?.finish_reason !== 'stop'
            ? Effect.fail(outcomeUnknown(provider))
            : Effect.succeed(output),
        ),
        Effect.flatMap((output) =>
          Effect.map(partsOf(output, options.responseFormat.type === 'json'), (parts) => ({ output, parts })),
        ),
      ),
      ({ output }) => {
        const input = output.usage.prompt_tokens ?? 0
        const written = output.usage.completion_tokens ?? 0
        return { units: input + written, costMicroUsd: textCost(task.model, input, written) }
      },
    ).pipe(Effect.map(({ parts }) => parts))
  })

/** The task's language model over The text provider. */
export const textModel = (task: TextTask) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const { run } = yield* TextCompletions
      const call = ask(task, run, yield* CaptureMetrics)
      return yield* LanguageModel.make({
        codecTransformer: toCodecOpenAI,
        generateText: (options) => call(options).pipe(Effect.mapError(aiErrorOf('generateText'))),
        streamText: (options) =>
          Stream.fromIterableEffect(call(options).pipe(Effect.map(streamed), Effect.mapError(aiErrorOf('streamText')))),
      })
    }),
  )
