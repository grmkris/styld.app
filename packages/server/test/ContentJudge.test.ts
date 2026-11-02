import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Predicate } from 'effect'
import { WorkersAi } from '../src/ai/LanguageModel.ts'
import type { RunClef } from '../src/providers/Clef.ts'
import { CaptureMetrics, type ProviderCall } from '../src/kernel/Metrics.ts'
import { ContentJudge, contentJudge, textVerdict } from '../src/safety/Judge.ts'

// The content judge's model calls go the one provider way: each deadlined and counted with what it cost, Llama Guard
// through the language model.

/** The judge over a Llama Guard and a Clef answering as given, every call counted. */
const judging = (guard: unknown, clef: RunClef) => {
  const calls: Array<Omit<ProviderCall, 'milliseconds'>> = []
  const metrics = Layer.succeed(
    CaptureMetrics,
    CaptureMetrics.of({
      ...CaptureMetrics.discarding,
      call: ({ milliseconds: _milliseconds, ...call }) => Effect.sync(() => void calls.push(call)),
    }),
  )
  const judge = contentJudge(clef).pipe(
    Layer.provide(WorkersAi.layer(() => Promise.resolve(guard))),
    Layer.provide(metrics),
  )
  return { calls, judge }
}

const picture = { bytes: new Uint8Array([1]), contentType: 'image/png' as const }

describe('the content judge', () => {
  it.effect('asks Llama Guard about the words and Clef about each picture, counting every call', () => {
    const { calls, judge } = judging(
      { response: 'unsafe\nS10', usage: { prompt_tokens: 100, completion_tokens: 2 } },
      async () => ({ answers: { sexual: { noul: 0.6 } }, usage: { input_tokens: 50 } }),
    )
    return Effect.gen(function* () {
      const verdict = yield* (yield* ContentJudge).judge({ texts: ['Autumn'], pictures: [picture] })
      expect(verdict).toEqual({ state: 'failed', reason: 'hate', model: 'llama-guard-3-8b' })
      expect(calls).toEqual([
        {
          provider: 'workers-ai',
          model: '@cf/meta/llama-guard-3-8b',
          kind: 'judge',
          outcome: 'ok',
          units: 102,
          costMicroUsd: 48,
        },
        { provider: 'clef', model: 'clef-flash', kind: 'judge', outcome: 'ok', units: 50, costMicroUsd: 2 },
      ])
    }).pipe(Effect.provide(judge))
  })

  it.effect('reads Llama Guard answering as an object', () => {
    const { judge } = judging({ response: { safe: false, categories: ['S2'] } }, async () => ({ answers: {} }))
    return Effect.gen(function* () {
      const verdict = yield* (yield* ContentJudge).judge({ texts: ['Autumn'], pictures: [] })
      expect(verdict).toEqual({ state: 'unsure', reason: 'other', model: 'llama-guard-3-8b' })
    }).pipe(Effect.provide(judge))
  })

  for (const [answer, verdict] of [
    ['safe', { state: 'passed', reason: null }],
    [' Safe\n', { state: 'passed', reason: null }],
    ['unsafe', { state: 'unsure', reason: 'other' }],
    ['unsafe\nS2', { state: 'unsure', reason: 'other' }],
    ['unsafe\nS2, S11', { state: 'failed', reason: 'selfHarm' }],
  ] as const)
    it.effect(`reads Llama Guard's text answer ${JSON.stringify(answer)}`, () =>
      Effect.map(textVerdict(answer), (read) => expect(read).toEqual({ ...verdict, model: 'llama-guard-3-8b' })),
    )

  for (const answer of [
    'Sorry, I cannot help with that.',
    'temporarily unavailable',
    'The text is safe to publish.',
    'unsafe content: none',
    '',
    '{"categories": ["S1"]}',
  ])
    it.effect(`gives no verdict on an answer in neither of Llama Guard's formats: ${JSON.stringify(answer)}`, () =>
      Effect.map(Effect.flip(textVerdict(answer)), (error) =>
        expect(Predicate.isTagged(error.reason, 'Broken')).toBe(true),
      ),
    )

  it.effect('counts a picture Clef could not read as failed, and gives no verdict', () => {
    const { calls, judge } = judging({ response: 'safe' }, async () => 'not an answer')
    return Effect.gen(function* () {
      const answer = yield* Effect.flip((yield* ContentJudge).judge({ texts: [], pictures: [picture] }))
      expect(Predicate.isTagged(answer.reason, 'Broken')).toBe(true)
      expect(calls.map(({ provider, outcome }) => [provider, outcome])).toEqual([['clef', 'failed']])
    }).pipe(Effect.provide(judge))
  })
})
