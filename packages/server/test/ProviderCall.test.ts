import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { CaptureMetrics, type ProviderCall } from '../src/kernel/Metrics.ts'
import { providerCall } from '../src/providers/Call.ts'
import { broken, busy, outcomeUnknown, refused } from '../src/providers/Errors.ts'

/** A counter that keeps every call it was told of. */
const counting = () => {
  const calls: Array<ProviderCall> = []
  return {
    calls,
    metrics: { ...CaptureMetrics.discarding, call: (call: ProviderCall) => Effect.sync(() => void calls.push(call)) },
  }
}

const spec = (replaySafe: boolean) =>
  ({ provider: 'meta-sam', model: 'sam-3.1', kind: 'segment', deadline: '10 seconds', replaySafe }) as const

/** A call that answers each try with the next of `answers`, counting its tries. */
const tries = (answers: ReadonlyArray<Effect.Effect<string, ReturnType<typeof busy>>>) => {
  let sent = 0
  const call = Effect.suspend(() => answers[Math.min(sent++, answers.length - 1)] ?? Effect.succeed('done'))
  return { call, sent: () => sent }
}

const priced = () => ({ units: 1, costMicroUsd: 2500 })

describe('a provider call', () => {
  it.effect('is tried again only while the provider is busy, and counted once with its outcome', () =>
    Effect.gen(function* () {
      const { calls, metrics } = counting()
      const busyThenDone = tries([busy('meta-sam'), busy('meta-sam'), Effect.succeed('masks')])
      const fiber = yield* Effect.forkChild(providerCall(metrics, spec(false), busyThenDone.call, priced))
      yield* TestClock.adjust('10 seconds')
      expect(yield* Fiber.join(fiber)).toBe('masks')
      expect(busyThenDone.sent()).toBe(3)
      expect(calls.map(({ outcome, costMicroUsd }) => [outcome, costMicroUsd])).toEqual([['ok', 2500]])
    }),
  )

  it.effect('never sends a refusal, an unreadable answer or a lost one again', () =>
    Effect.gen(function* () {
      const { calls, metrics } = counting()
      for (const failure of [refused('meta-sam'), broken('meta-sam'), outcomeUnknown('meta-sam')]) {
        const once = tries([failure])
        const exit = yield* Effect.exit(providerCall(metrics, spec(false), once.call, priced))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(once.sent()).toBe(1)
      }
      expect(calls.map(({ outcome }) => outcome)).toEqual(['failed', 'failed', 'unknown'])
    }),
  )

  it.effect(
    'past its deadline is an unknown outcome when it was paid work, and busy when it was safe to send again',
    () =>
      Effect.gen(function* () {
        const { metrics } = counting()
        const hanging = Effect.never
        const paid = yield* Effect.forkChild(Effect.flip(providerCall(metrics, spec(false), hanging, priced)))
        yield* TestClock.adjust('10 seconds')
        expect(yield* Fiber.join(paid)).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
        const question = yield* Effect.forkChild(Effect.flip(providerCall(metrics, spec(true), hanging, priced)))
        yield* TestClock.adjust('2 minutes')
        expect(yield* Fiber.join(question)).toMatchObject({ reason: { _tag: 'Busy' } })
      }),
  )
})
