import { Duration, Option, Schema } from 'effect'

/** How long one model call may take before it fails. On the preview (31 October) DeepSeek V4.1 Flash answered 53 of
 * Styld's calls at a median of 3.1 s, the slowest in 30 s; one Workers AI call that never answered held its reply 235
 * s, the chat showing Styld writing all that time. */
export const callPatience = Duration.seconds(45)

/** Workers AI's Chat Completions models over the Worker's `AI` binding, as a `fetch` the OpenAI-compatible client can
 * use: the request the client posts to `/chat/completions` goes to `run`, and its answer comes back as the client
 * expects it. The binding is asked without streaming, since its streamed answers end without a finish reason (31
 * October); a streamed request gets the whole answer as one chunk, then its finish and usage. `extra` goes with every
 * request, such as a reasoning effort. */
export type RunChat = (model: string, input: Readonly<Record<string, unknown>>) => Promise<unknown>

const Body = Schema.Record(Schema.String, Schema.Unknown)
const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Body))

const Completion = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  created: Schema.optionalKey(Schema.Number),
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.optionalKey(Schema.NullOr(Schema.String)),
        tool_calls: Schema.optionalKey(Schema.NullOr(Schema.Array(Body))),
      }),
      finish_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
  usage: Schema.optionalKey(Schema.Unknown),
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The answer as Server-Sent Events: its words and tool calls in one delta, then its finish with the usage. */
const streamed = (model: string, completion: typeof Completion.Type) => {
  const id = completion.id ?? 'workers-ai'
  const created = completion.created ?? 0
  const chunk = (choice: object, usage?: unknown) =>
    `data: ${JSON.stringify({ id, created, model, object: 'chat.completion.chunk', choices: [{ index: 0, ...choice }], ...(usage === undefined ? {} : { usage }) })}\n\n`
  const events = completion.choices.flatMap(({ message, finish_reason }) => {
    const toolCalls = (message.tool_calls ?? []).map((call, index) => ({ ...call, index }))
    return [
      chunk({
        delta: {
          role: 'assistant',
          content: message.content ?? '',
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: null,
      }),
      chunk(
        { delta: {}, finish_reason: finish_reason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop') },
        completion.usage,
      ),
    ]
  })
  return new Response([...events, 'data: [DONE]\n\n'].join(''), { headers: { 'content-type': 'text/event-stream' } })
}

export const workersAiFetch = (
  run: RunChat,
  extra: Readonly<Record<string, unknown>> = {},
): typeof globalThis.fetch => {
  const complete = async (_input: unknown, init?: RequestInit) => {
    const sent = init?.body
    const body = decodeBody(
      typeof sent === 'string' ? sent : sent instanceof Uint8Array ? new TextDecoder().decode(sent) : '',
    )
    if (Option.isNone(body)) return json({ error: { message: 'Not a chat completion request' } }, 400)
    const { model, stream, stream_options: _options, ...input } = body.value
    if (typeof model !== 'string') return json({ error: { message: 'No model named' } }, 400)
    const output = await run(model, { ...input, ...extra }).then(
      (answer) => Schema.decodeUnknownOption(Completion)(answer),
      () => undefined,
    )
    if (output === undefined) return json({ error: { message: 'Workers AI did not answer' } }, 503)
    if (Option.isNone(output)) return json({ error: { message: 'Workers AI answered no completion' } }, 502)
    return stream === true ? streamed(model, output.value) : json(output.value)
  }
  // Nothing to connect ahead of time: the binding is in the Worker.
  return Object.assign(complete, { preconnect: () => undefined })
}
