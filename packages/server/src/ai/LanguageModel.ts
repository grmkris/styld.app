import { type Duration, Context, Effect, Layer, Predicate, Schema, Stream } from 'effect'
import { AiError, LanguageModel, Prompt, type Response, Tool } from 'effect/ai'
import { toCodecOpenAI } from 'effect/ai/OpenAiStructuredOutput'
import { CaptureMetrics, type ProviderCall } from '../kernel/Metrics.ts'
import { providerCall } from '../providers/Call.ts'
import { type TextModel, textCost } from '../providers/Costs.ts'
import { broken, busy, outcomeUnknown, type ProviderError, refused } from '../providers/Errors.ts'

// One language model for every text task (owner, 2026-11-01): Effect's `LanguageModel` over the Worker's Workers AI
// binding, so the mood-board planner and Thinking ask for an object of a Schema (`generateObject`), Styld chats with
// its Toolkit (`Chat`) and Llama Guard reads words (`generateText`), each call through `providerCall`: deadlined,
// tried again only while busy, counted and priced. Workers AI is asked without streaming (its streamed answers end
// without a finish reason, 31 October); a streamed request gets the whole answer at once. What a model is sent and
// answers is never logged.

/** The Worker's `AI` binding, as Styld runs its text models: a model id and its input, the model's answer. */
export class WorkersAi extends Context.Service<
  WorkersAi,
  { readonly run: (model: string, input: Readonly<Record<string, unknown>>) => Promise<unknown> }
>()('@styld/server/ai/WorkersAi') {
  static readonly layer = (run: WorkersAi['Service']['run']) => Layer.succeed(this, { run })
}

/** One text task: the model it asks, what its calls are counted as, and how long one call may take. */
export interface TextTask {
  readonly model: TextModel
  readonly kind: ProviderCall['kind']
  readonly deadline: Duration.Input
}

const provider = 'workers-ai'

const Usage = Schema.Struct({
  prompt_tokens: Schema.optionalKey(Schema.Number),
  completion_tokens: Schema.optionalKey(Schema.Number),
})

const ToolCall = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  function: Schema.Struct({ name: Schema.String, arguments: Schema.optionalKey(Schema.Unknown) }),
})

/** Whether an answer says something: the first choice's words or tool calls, or else an older model's `response`. An
 * answer with neither (`{}`, an empty message) is unreadable, never an empty answer. */
const answers = (output: {
  readonly response?: unknown
  readonly choices?: ReadonlyArray<{
    readonly message: { readonly content?: string | null; readonly tool_calls?: ReadonlyArray<unknown> | null }
  }>
}) => {
  const message = output.choices?.[0]?.message
  if (message === undefined) return output.response !== undefined && output.response !== ''
  return (message.content ?? '').length > 0 || (message.tool_calls ?? []).length > 0
}

/** Workers AI answers older models with `response` (text, or the object asked for), newer ones as a Chat Completion. */
const Output = Schema.Struct({
  response: Schema.optionalKey(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)])),
  choices: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        message: Schema.Struct({
          content: Schema.optionalKey(Schema.NullOr(Schema.String)),
          tool_calls: Schema.optionalKey(Schema.NullOr(Schema.Array(ToolCall))),
        }),
        finish_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  usage: Schema.optionalKey(Usage),
}).check(Schema.makeFilter(answers))
type Output = typeof Output.Type

/** How a provider failure reads as an `AiError`, and back: one mapping each way, so a caller of the language model
 * handles the same `ProviderError` reasons as any other provider call. */
const aiErrorOf = (method: string) => (error: ProviderError) =>
  AiError.make({
    module: 'WorkersAi',
    method,
    reason: Predicate.isTagged(error.reason, 'Broken')
      ? new AiError.InvalidOutputError({ description: 'Workers AI answered something unreadable' })
      : Predicate.isTagged(error.reason, 'Refused')
        ? new AiError.InvalidRequestError({ description: 'Workers AI refused the request' })
        : Predicate.isTagged(error.reason, 'OutcomeUnknown')
          ? new AiError.UnknownError({ description: 'Workers AI may have answered' })
          : new AiError.InternalProviderError({ description: 'Workers AI did not answer in time' }),
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
  if (is(readingFailures)) return broken(provider)
  if (is(refusals)) return refused(provider)
  return is(['UnknownError']) ? outcomeUnknown(provider) : busy(provider)
}

/** The JSON text of an answer, without the code fence some models put around it. */
const unfenced = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '')

/** The prompt as Chat Completions messages. Styld sends only words, so a file in it is a request Workers AI cannot
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
      parameters: Tool.getJsonSchema(tool, { transformer: toCodecOpenAI }),
      strict: Tool.getStrictMode(tool) ?? true,
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

/** The request Workers AI is sent: the messages, the tools, and for an object the JSON schema it must answer in. */
const requestOf = (options: LanguageModel.ProviderOptions) =>
  Effect.try({
    try: (): Readonly<Record<string, unknown>> => ({
      messages: messagesOf(options.prompt),
      ...toolsOf(options),
      ...(options.responseFormat.type === 'json'
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: Tool.getJsonSchemaFromSchema(options.responseFormat.schema, { transformer: toCodecOpenAI }),
            },
          }
        : {}),
    }),
    catch: () => refused(provider),
  })

const finishOf = (reason: string | null | undefined, called: boolean): Response.FinishPartEncoded['reason'] => {
  if (reason === 'length') return 'length'
  if (reason === 'content_filter') return 'content-filter'
  return called || reason === 'tool_calls' ? 'tool-calls' : 'stop'
}

/** Words without the model's reasoning: a reasoning model's thoughts come in `reasoning_content`, which is never read,
 * or in its words between `<think>` tags, or before a lone `</think>` when the opening tag was in the prompt's
 * template. None of it is the answer. */
const withoutReasoning = (text: string) =>
  text
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gu, '')
    .replace(/^[\s\S]*<\/think>/u, '')
    .trimStart()

/** The answer's words: the message's, or an older model's `response` (an object asked for, as its JSON). */
const textOf = (output: Output, json: boolean) => {
  const content = output.choices?.[0]?.message.content ?? output.response
  const text = withoutReasoning(
    typeof content === 'string' ? content : content === undefined ? '' : JSON.stringify(content),
  )
  return json ? unfenced(text) : text
}

const paramsOf = (call: typeof ToolCall.Type) =>
  Effect.try({
    try: () =>
      typeof call.function.arguments === 'string'
        ? Tool.unsafeSecureJsonParse(call.function.arguments)
        : (call.function.arguments ?? {}),
    catch: () => broken(provider),
  })

/** The answer as response parts: its words, its tool calls and its finish with the tokens billed. */
const partsOf = Effect.fnUntraced(function* (output: Output, json: boolean) {
  const choice = output.choices?.[0]
  const calls = choice?.message.tool_calls ?? []
  const text = textOf(output, json)
  const toolCalls = yield* Effect.forEach(calls, (call, index) =>
    Effect.map(paramsOf(call), (params): Response.PartEncoded => ({
      type: 'tool-call',
      id: call.id ?? `call_${String(index)}`,
      name: call.function.name,
      params,
    })),
  )
  const input = output.usage?.prompt_tokens
  const written = output.usage?.completion_tokens
  const finish: Response.PartEncoded = {
    type: 'finish',
    reason: finishOf(choice?.finish_reason, toolCalls.length > 0),
    usage: {
      inputTokens: { uncached: input, total: input, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: written, text: written, reasoning: undefined },
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
const ask = (task: TextTask, run: WorkersAi['Service']['run'], metrics: CaptureMetrics['Service']) =>
  Effect.fnUntraced(function* (options: LanguageModel.ProviderOptions) {
    const request = yield* requestOf(options)
    return yield* providerCall(
      metrics,
      { provider, model: task.model.id, kind: task.kind, deadline: task.deadline, replaySafe: true },
      Effect.tryPromise({ try: () => run(task.model.id, request), catch: () => busy(provider) }).pipe(
        Effect.flatMap((raw) => Schema.decodeUnknownEffect(Output)(raw).pipe(Effect.mapError(() => broken(provider)))),
        Effect.flatMap((output) =>
          Effect.map(partsOf(output, options.responseFormat.type === 'json'), (parts) => ({ output, parts })),
        ),
      ),
      ({ output }) => {
        const input = output.usage?.prompt_tokens ?? 0
        const written = output.usage?.completion_tokens ?? 0
        return { units: input + written, costMicroUsd: textCost(task.model, input, written) }
      },
    ).pipe(Effect.map(({ parts }) => parts))
  })

/** The task's language model over Workers AI. */
export const workersAiModel = (task: TextTask) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const { run } = yield* WorkersAi
      const call = ask(task, run, yield* CaptureMetrics)
      return yield* LanguageModel.make({
        codecTransformer: toCodecOpenAI,
        generateText: (options) => call(options).pipe(Effect.mapError(aiErrorOf('generateText'))),
        streamText: (options) =>
          Stream.fromIterableEffect(call(options).pipe(Effect.map(streamed), Effect.mapError(aiErrorOf('streamText')))),
      })
    }),
  )
