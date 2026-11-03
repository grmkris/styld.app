import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Schema } from 'effect'
import { Chat, LanguageModel, Tool, Toolkit } from 'effect/ai'
import { TestClock } from 'effect/testing'
import { providerErrorOf, textModel, type TextTask } from '../src/ai/LanguageModel.ts'
import { CaptureMetrics, type ProviderCall } from '../src/kernel/Metrics.ts'
import { deadlines } from '../src/providers/Call.ts'
import { textModels } from '../src/providers/Costs.ts'
import { makeTextCompletions, TextCompletions } from '../src/providers/Text.ts'
import { Redacted } from 'effect'

const task: TextTask = { model: textModels.deepSeekFlash, kind: 'plan', deadline: deadlines.chat, maxTokens: 1024 }
const usage = { prompt_tokens: 1000, completion_tokens: 100 }
const completion = (content: string | null, toolCalls: ReadonlyArray<unknown> = [], finish = 'stop') => ({
  choices: [{ message: { content, tool_calls: toolCalls }, finish_reason: finish }],
  usage,
})

/** The actual HTTP adapter over bounded fixture responses. Captures only synthetic requests. */
const gateway = (answers: ReadonlyArray<unknown>) => {
  const asked: Array<Readonly<Record<string, unknown>>> = []
  const signals: Array<AbortSignal> = []
  const calls: Array<Omit<ProviderCall, 'milliseconds'>> = []
  const client = makeTextCompletions({
    base: 'https://gateway.invalid/v1',
    key: Redacted.make('test-key'),
    fetch: async (url, init) => {
      expect(url).toBe('https://gateway.invalid/v1/chat/completions')
      expect(init.headers).toMatchObject({ authorization: 'Bearer test-key', 'content-type': 'application/json' })
      const body: unknown = await new Response(init.body).json()
      asked.push(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(body))
      if (init.signal) signals.push(init.signal)
      const answer = answers[Math.min(asked.length, answers.length) - 1]
      if (answer instanceof Error) throw answer
      if (answer === 'never') return new Promise(() => undefined)
      return answer instanceof Response ? answer.clone() : Response.json(answer)
    },
  })
  const layer = textModel(task).pipe(
    Layer.provide(Layer.succeed(TextCompletions, client)),
    Layer.provide(
      Layer.succeed(CaptureMetrics, {
        ...CaptureMetrics.discarding,
        call: ({ milliseconds: _milliseconds, ...call }) => Effect.sync(() => void calls.push(call)),
      }),
    ),
  )
  return { asked, signals, calls, layer }
}

const Answer = Schema.Struct({ ok: Schema.Boolean })
const object = Effect.flatMap(LanguageModel.LanguageModel, (model) =>
  model.generateObject({ objectName: 'answer', prompt: 'Is it ok?', schema: Answer }),
)
const text = Effect.flatMap(LanguageModel.LanguageModel, (model) => model.generateText({ prompt: 'Hello' }))

describe('the paid text route', () => {
  for (const content of ['{"ok":true}', '```json\n{"ok":true}\n```'])
    it.effect('validates JSON locally and counts the gateway model and its usage', () => {
      const { asked, calls, layer } = gateway([completion(content)])
      return Effect.gen(function* () {
        expect((yield* object).value).toEqual({ ok: true })
        expect(asked[0]).toMatchObject({
          model: 'styld-deepseek-v4.1-flash',
          stream: false,
          max_tokens: 1024,
          reasoning_effort: 'none',
          response_format: { type: 'json_object' },
        })
        expect(JSON.stringify(asked[0]?.['messages'])).toContain('JSON schema')
        expect(JSON.stringify(asked[0]?.['messages'])).toContain('required')
        expect(calls).toEqual([
          { provider: 'litellm', model: task.model.id, kind: 'plan', outcome: 'ok', units: 1100, costMicroUsd: 396 },
        ])
      }).pipe(Effect.provide(layer))
    })

  for (const raw of [
    {},
    { response: 'legacy' },
    completion(''),
    { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] },
    { ...completion('Hello'), usage: { prompt_tokens: -1, completion_tokens: 2 } },
  ])
    it.effect('rejects unreadable, empty, unpriced and legacy answers without retry', () => {
      const { asked, layer } = gateway([raw])
      return Effect.gen(function* () {
        expect(providerErrorOf(yield* Effect.flip(text))).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
        expect(asked).toHaveLength(1)
      }).pipe(Effect.provide(layer))
    })

  it.effect('rejects valid JSON that violates the requested schema', () => {
    const { asked, layer } = gateway([completion('{"ok":"yes"}')])
    return Effect.gen(function* () {
      expect(providerErrorOf(yield* Effect.flip(object))).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
      expect(asked).toHaveLength(1)
    }).pipe(Effect.provide(layer))
  })

  for (const finish of ['length', 'content_filter', 'tool_calls', 'mystery'])
    it.effect(`does not accept a structured answer with finish reason ${finish}`, () => {
      const { asked, calls, layer } = gateway([completion('{"ok":true}', [], finish)])
      return Effect.gen(function* () {
        expect(providerErrorOf(yield* Effect.flip(object))).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
        expect(asked).toHaveLength(1)
        expect(calls.map(({ outcome }) => outcome)).toEqual(['unknown'])
      }).pipe(Effect.provide(layer))
    })

  it.effect('accepts null usage detail objects when totals are present', () => {
    const { layer } = gateway([
      {
        ...completion('{"ok":true}'),
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 100,
          prompt_tokens_details: null,
          completion_tokens_details: null,
        },
      },
    ])
    return Effect.gen(function* () {
      expect((yield* object).value).toEqual({ ok: true })
    }).pipe(Effect.provide(layer))
  })

  for (const status of [400, 401, 402, 403])
    it.effect(`does not retry an HTTP ${status} refusal`, () => {
      const { asked, layer } = gateway([Response.json({ error: { code: 'refused' } }, { status })])
      return Effect.gen(function* () {
        expect(providerErrorOf(yield* Effect.flip(text))).toMatchObject({ reason: { _tag: 'Refused' } })
        expect(asked).toHaveLength(1)
      }).pipe(Effect.provide(layer))
    })

  for (const status of [429])
    it.effect(`retries a provider-busy HTTP ${status} response, then uses its answer`, () => {
      const { asked, layer } = gateway([Response.json({}, { status }), completion('Hello')])
      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(text)
        yield* TestClock.adjust('2 seconds')
        expect((yield* Fiber.join(fiber)).text).toBe('Hello')
        expect(asked).toHaveLength(2)
      }).pipe(Effect.provide(layer))
    })

  for (const status of [408, 500, 502, 503, 504])
    it.effect(`does not resubmit an ambiguous HTTP ${status} gateway failure`, () => {
      const { asked, calls, layer } = gateway([Response.json({}, { status })])
      return Effect.gen(function* () {
        expect(providerErrorOf(yield* Effect.flip(text))).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
        expect(asked).toHaveLength(1)
        expect(calls.map(({ outcome }) => outcome)).toEqual(['unknown'])
      }).pipe(Effect.provide(layer))
    })

  it.effect('a lost paid response is unknown and never sent twice', () => {
    const { asked, calls, layer } = gateway([new Error('connection reset')])
    return Effect.gen(function* () {
      expect(providerErrorOf(yield* Effect.flip(text))).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
      expect(asked).toHaveLength(1)
      expect(calls.map(({ outcome }) => outcome)).toEqual(['unknown'])
    }).pipe(Effect.provide(layer))
  })

  it.effect('aborts a timed-out request and never resends its unknown outcome', () => {
    const { asked, signals, calls, layer } = gateway(['never'])
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(text))
      yield* TestClock.adjust(deadlines.chat)
      expect(providerErrorOf(yield* Fiber.join(fiber))).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
      expect(asked).toHaveLength(1)
      expect(signals[0]?.aborted).toBe(true)
      expect(calls.map(({ outcome }) => outcome)).toEqual(['unknown'])
    }).pipe(Effect.provide(layer))
  })
})

describe('a chat with tools', () => {
  it.effect('executes a validated tool once and sends its result with the original call id', () => {
    const { asked, layer } = gateway([
      completion(
        'Looking.',
        [{ id: 'call_1', type: 'function', function: { name: 'piece_search', arguments: '{"type":"tops"}' } }],
        'tool_calls',
      ),
      completion('Wear the navy shirt.'),
    ])
    const search = Tool.make('piece_search', {
      description: 'Search the wardrobe.',
      parameters: Schema.Struct({ type: Schema.String }),
      success: Schema.String,
    })
    const toolkit = Toolkit.make(search)
    let executions = 0
    return Effect.gen(function* () {
      const chat = yield* Chat.empty
      const handlers = toolkit.toLayer({
        piece_search: ({ type }) =>
          Effect.sync(() => {
            executions++
            return type
          }),
      })
      const tools = yield* toolkit.pipe(Effect.provide(handlers))
      yield* chat.generateText({ prompt: 'What to wear?', toolkit: tools })
      expect((yield* chat.generateText({ prompt: [], toolkit: tools })).text).toBe('Wear the navy shirt.')
      expect(executions).toBe(1)
      expect(JSON.stringify(asked[1]?.['messages'])).toContain('call_1')
      expect(asked[0]?.['tools']).toMatchObject([{ type: 'function', function: { name: 'piece_search' } }])
    }).pipe(Effect.provide(layer))
  })

  it.effect('does not execute a tool from a truncated answer', () => {
    const { layer } = gateway([
      completion('', [{ id: 'call_1', function: { name: 'search', arguments: '{}' } }], 'length'),
    ])
    const search = Tool.make('search', { parameters: Schema.Struct({}), success: Schema.String })
    const toolkit = Toolkit.make(search)
    let executions = 0
    return Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      const tools = yield* toolkit.pipe(
        Effect.provide(
          toolkit.toLayer({
            search: () =>
              Effect.sync(() => {
                executions++
                return 'found'
              }),
          }),
        ),
      )
      const answer = yield* model.generateText({ prompt: 'Find', toolkit: tools })
      expect(answer.finishReason).toBe('length')
      expect(executions).toBe(0)
    }).pipe(Effect.provide(layer))
  })
})

describe('a reasoning response', () => {
  for (const content of [
    '<think>private thought</think>Wear the navy coat.',
    'private thought</think>Wear the navy coat.',
  ])
    it.effect('shows only the answer while accounting for billed reasoning and cached tokens', () => {
      const raw = {
        ...completion(content),
        usage: {
          ...usage,
          prompt_tokens_details: { cached_tokens: 200 },
          completion_tokens_details: { reasoning_tokens: 40 },
        },
      }
      const { layer } = gateway([raw])
      return Effect.gen(function* () {
        const answer = yield* text
        expect(answer.text).toBe('Wear the navy coat.')
        expect(answer.usage.inputTokens).toMatchObject({ total: 1000, uncached: 800, cacheRead: 200 })
        expect(answer.usage.outputTokens).toMatchObject({ total: 100, text: 60, reasoning: 40 })
      }).pipe(Effect.provide(layer))
    })
})
