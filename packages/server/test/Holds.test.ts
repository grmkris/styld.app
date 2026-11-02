import { outcomeUnknown } from '../src/providers/Errors.ts'
import { describe, expect, it } from '@effect/vitest'
import { LimitReached } from '@styld/protocol'
import { Effect, Exit, Layer, Schema } from 'effect'
import { type Charge, type Ending, holdId, Holds, metered, settlementOf } from '../src/usage/Holds.ts'

class Refused extends Schema.TaggedError<Refused>()('Refused', {}) {}

/** A Wallet that records what was held and how each hold settled, and refuses past `credits`. */
const recording = (credits = 10) => {
  const log: Array<string> = []
  const layer = Layer.succeed(
    Holds,
    Holds.of({
      reserve: (charge: Charge) =>
        charge.credits > credits
          ? Effect.fail(LimitReached.make({ limit: 'dailyCredits', resetsAt: '2026-11-02T00:00:00.000Z' }))
          : Effect.sync(() => void log.push(`reserve ${charge.hold}`)),
      settle: (_accountId: string, hold: string, ending: Ending) =>
        Effect.sync(() => void log.push(`${settlementOf(ending)} ${hold} (${ending})`)),
      remaining: () => Effect.succeed(credits),
      sweep: Effect.succeed(0),
    }),
  )
  return { log, layer }
}

const charge = { accountId: 'ac_1', hold: holdId('piece', 'pc_1', 1), credits: 1 }

describe('a metered call', () => {
  it.effect('consumes the hold when the work succeeds', () => {
    const { log, layer } = recording()
    return Effect.gen(function* () {
      expect(yield* metered(charge, Effect.succeed('cut'))).toBe('cut')
      expect(log).toEqual(['reserve piece/pc_1/1', 'consumed piece/pc_1/1 (succeeded)'])
    }).pipe(Effect.provide(layer))
  })

  it.effect('refunds a known failure and a lost provider answer alike', () => {
    const { log, layer } = recording()
    return Effect.gen(function* () {
      const refused = yield* Effect.exit(metered(charge, Refused.make({})))
      const lost = yield* Effect.exit(metered(charge, outcomeUnknown('meta-sam')))
      expect(Exit.isFailure(refused) && Exit.isFailure(lost)).toBe(true)
      expect(log).toEqual([
        'reserve piece/pc_1/1',
        'refunded piece/pc_1/1 (failed)',
        'reserve piece/pc_1/1',
        'refunded piece/pc_1/1 (unknown)',
      ])
    }).pipe(Effect.provide(layer))
  })

  it.effect('runs nothing past the daily limit', () => {
    const { log, layer } = recording(0)
    return Effect.gen(function* () {
      let ran = false
      const exit = yield* Effect.exit(
        metered(
          charge,
          Effect.sync(() => (ran = true)),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(ran).toBe(false)
      expect(log).toEqual([])
    }).pipe(Effect.provide(layer))
  })
})

describe('a hold id', () => {
  it('names what it pays for and the attempt, so a retry never reuses a settled hold', () => {
    expect(holdId('capture', 'cp_1', 0)).toBe('capture/cp_1/0')
    expect(holdId('capture', 'cp_1', 1)).not.toBe(holdId('capture', 'cp_1', 0))
  })
})
