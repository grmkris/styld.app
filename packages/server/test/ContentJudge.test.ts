import { describe, expect, it } from '@effect/vitest'
import { Effect, Predicate } from 'effect'
import { CaptureMetrics, type ProviderCall } from '../src/capture/Metrics.ts'
import { ContentJudge, contentJudge } from '../src/safety/Judge.ts'

// The content judge's model calls go the one provider way: each deadlined and counted with what it cost.

const counting = () => {
  const calls: Array<Omit<ProviderCall, 'milliseconds'>> = []
  const metrics = CaptureMetrics.of({
    ...CaptureMetrics.discarding,
    call: ({ milliseconds: _milliseconds, ...call }) => Effect.sync(() => void calls.push(call)),
  })
  return { calls, metrics }
}

describe('the content judge', () => {
  it.effect('asks Llama Guard about the words and Clef about each picture, counting every call', () => {
    const { calls, metrics } = counting()
    const judge = contentJudge({
      metrics,
      runGuard: async () => ({ response: 'unsafe\nS10', usage: { prompt_tokens: 100, completion_tokens: 2 } }),
      runClef: async () => ({ answers: { sexual: { noul: 0.6 } }, usage: { input_tokens: 50 } }),
    })
    return Effect.gen(function* () {
      const verdict = yield* (yield* ContentJudge).judge({
        texts: ['Autumn'],
        pictures: [{ bytes: new Uint8Array([1]), contentType: 'image/png' }],
      })
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

  it.effect('counts a picture Clef could not read as failed, and gives no verdict', () => {
    const { calls, metrics } = counting()
    const judge = contentJudge({
      metrics,
      runGuard: async () => ({ response: 'safe' }),
      runClef: async () => 'not an answer',
    })
    return Effect.gen(function* () {
      const answer = yield* Effect.flip(
        (yield* ContentJudge).judge({
          texts: [],
          pictures: [{ bytes: new Uint8Array([1]), contentType: 'image/png' }],
        }),
      )
      expect(Predicate.isTagged(answer.reason, 'Broken')).toBe(true)
      expect(calls.map(({ provider, outcome }) => [provider, outcome])).toEqual([['clef', 'failed']])
    }).pipe(Effect.provide(judge))
  })
})
