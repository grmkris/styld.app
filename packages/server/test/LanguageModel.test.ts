import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Predicate, Schema } from 'effect'
import { LanguageModel, Tool, Toolkit } from 'effect/ai'
import { TestClock } from 'effect/testing'
import { providerErrorOf, type TextTask, WorkersAi, workersAiModel } from '../src/ai/LanguageModel.ts'
import { CaptureMetrics, type ProviderCall } from '../src/kernel/Metrics.ts'
import { deadlines } from '../src/providers/Call.ts'
import { textModels } from '../src/providers/Costs.ts'

// One language model over the Workers AI binding: what it sends, how it reads every answer shape, and that each call
// is deadlined, tried again only while busy, counted and priced.

const task: TextTask = { model: textModels.llama70b, kind: 'plan', deadline: deadlines.chat }

/** Workers AI answering `answers` in turn (the last again once they run out), keeping what it was asked and each
 * call counted. */
const workersAi = (answers: ReadonlyArray<unknown>) => {
  const asked: Array<Readonly<Record<string, unknown>>> = []
  const calls: Array<Omit<ProviderCall, 'milliseconds'>> = []
  const layer = workersAiModel(task).pipe(
    Layer.provide(
      WorkersAi.layer((_model, input) => {
        asked.push(input)
        const answer = answers[Math.min(asked.length, answers.length) - 1]
        return answer instanceof Error
          ? Promise.reject(answer)
          : answer === 'never'
            ? new Promise(() => undefined)
            : Promise.resolve(answer)
      }),
    ),
    Layer.provide(
      Layer.succeed(
        CaptureMetrics,
        CaptureMetrics.of({
          ...CaptureMetrics.discarding,
          call: ({ milliseconds: _milliseconds, ...call }) => Effect.sync(() => void calls.push(call)),
        }),
      ),
    ),
  )
  return { asked, calls, layer }
}

const Answer = Schema.Struct({ ok: Schema.Boolean })
const object = Effect.flatMap(LanguageModel.LanguageModel, (model) =>
  model.generateObject({ objectName: 'answer', prompt: 'Is it ok?', schema: Answer }),
)

describe('an object asked of a Workers AI model', () => {
  const usage = { prompt_tokens: 1000, completion_tokens: 100 }

  for (const [shape, raw] of [
    ['an object', { response: { ok: true }, usage }],
    ['JSON text', { response: '{"ok": true}', usage }],
    ['fenced JSON', { response: '```json\n{"ok": true}\n```', usage }],
    ['a Chat Completion', { choices: [{ message: { content: '{"ok": true}' } }], usage }],
  ] as const)
    it.effect(`reads ${shape}, priced by its tokens, and sends the answer's JSON schema`, () => {
      const { asked, calls, layer } = workersAi([raw])
      return Effect.gen(function* () {
        const answer = yield* object
        expect(answer.value).toEqual({ ok: true })
        expect(calls).toEqual([
          { provider: 'workers-ai', model: task.model.id, kind: 'plan', outcome: 'ok', units: 1100, costMicroUsd: 515 },
        ])
        expect(asked[0]?.['response_format']).toMatchObject({
          type: 'json_schema',
          json_schema: { type: 'object', required: ['ok'] },
        })
        expect(asked[0]?.['messages']).toEqual([{ role: 'user', content: 'Is it ok?' }])
      }).pipe(Effect.provide(layer))
    })

  it.effect('an answer of another shape is Broken, and is not asked again', () => {
    const { asked, layer } = workersAi([{ response: { ok: 'yes' } }])
    return Effect.gen(function* () {
      const error = providerErrorOf(yield* Effect.flip(object))
      expect(Predicate.isTagged(error.reason, 'Broken')).toBe(true)
      expect(asked).toHaveLength(1)
    }).pipe(Effect.provide(layer))
  })

  for (const [shape, raw] of [
    ['nothing', {}],
    ['an empty response', { response: '' }],
    ['an empty message', { choices: [{ message: { content: null } }] }],
  ] as const)
    it.effect(`an answer of ${shape} is Broken, never an empty answer`, () => {
      const { asked, layer } = workersAi([raw])
      return Effect.gen(function* () {
        const text = Effect.flatMap(LanguageModel.LanguageModel, (model) => model.generateText({ prompt: 'Hello' }))
        const error = providerErrorOf(yield* Effect.flip(text))
        expect(Predicate.isTagged(error.reason, 'Broken')).toBe(true)
        expect(asked).toHaveLength(1)
      }).pipe(Effect.provide(layer))
    })

  it.effect('a model that does not answer is Busy: tried three more times, counted once as failed', () => {
    const { asked, calls, layer } = workersAi([new Error('down')])
    return Effect.gen(function* () {
      const failing = yield* Effect.forkChild(Effect.flip(object))
      yield* TestClock.adjust('10 seconds')
      const error = providerErrorOf(yield* Fiber.join(failing))
      expect(Predicate.isTagged(error.reason, 'Busy')).toBe(true)
      expect(asked).toHaveLength(4)
      expect(calls.map(({ outcome }) => outcome)).toEqual(['failed'])
    }).pipe(Effect.provide(layer))
  })

  it.effect('a call held open past its deadline is Busy, then answered on a later try', () => {
    const { asked, layer } = workersAi(['never', { response: '{"ok": false}' }])
    return Effect.gen(function* () {
      const asking = yield* Effect.forkChild(object)
      yield* TestClock.adjust(deadlines.chat)
      yield* TestClock.adjust('1 second')
      expect((yield* Fiber.join(asking)).value).toEqual({ ok: false })
      expect(asked).toHaveLength(2)
    }).pipe(Effect.provide(layer))
  })
})

describe('a chat with tools', () => {
  it.effect('tool calls come back as tool-call parts, and the chat so far goes as Chat Completions messages', () => {
    const { asked, layer } = workersAi([
      {
        choices: [
          {
            message: {
              content: 'Looking.',
              tool_calls: [{ id: 'call_1', function: { name: 'piece_search', arguments: '{"type":"tops"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ])
    const search = Tool.dynamic('piece_search', {
      description: 'Search the wardrobe.',
      parameters: { type: 'object', properties: { type: { type: 'string' } } },
    })
    const toolkit = Toolkit.make(search)
    return Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      const answer = yield* model.generateText({
        prompt: [
          { role: 'system', content: 'Styld' },
          { role: 'user', content: 'What to wear?' },
          { role: 'assistant', content: 'Let me see.' },
        ],
        toolkit: yield* toolkit.pipe(
          Effect.provide(toolkit.toLayer({ piece_search: () => Effect.succeed({ pieces: [] }) })),
        ),
      })
      expect(answer.text).toBe('Looking.')
      expect(answer.toolCalls.map(({ name, params }) => [name, params])).toEqual([['piece_search', { type: 'tops' }]])
      expect(answer.finishReason).toBe('tool-calls')
      expect(asked[0]?.['messages']).toEqual([
        { role: 'system', content: 'Styld' },
        { role: 'user', content: 'What to wear?' },
        { role: 'assistant', content: 'Let me see.' },
      ])
      expect(asked[0]?.['tools']).toEqual([
        {
          type: 'function',
          function: {
            name: 'piece_search',
            description: 'Search the wardrobe.',
            parameters: { type: 'object', properties: { type: { type: 'string' } } },
            strict: true,
          },
        },
      ])
    }).pipe(Effect.provide(layer))
  })
})
