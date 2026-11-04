import * as Domain from '@alchemy.run/domain'
import { describe, expect, it } from '@effect/vitest'
import { freeCredits, memberDailyCredits } from '@styld/protocol'
import { Styld } from '@styld/domain/Styld.model'
import { Effect, Layer, Schema } from 'effect'
import { Database } from '../src/kernel/Db.ts'
import { busy, outcomeUnknown } from '../src/providers/Errors.ts'
import { PaidAttempts } from '../src/usage/Attempts.ts'
import { holdId, Holds } from '../src/usage/Holds.ts'
import { localD1 } from './LocalD1.ts'

/** A member's credits on a fresh day: the day's allowance and the free credits. */
const allCredits = memberDailyCredits + freeCredits

// Paid provider work runs once however often its queue delivers it: one delivery claims it and stores its result, a
// repeat resumes from that result, a delivery that finds a live claim leaves the work to it, and a claim whose delivery
// died without a result is an unknown outcome: refunded, never sent again. The Wallet is the real aggregate in memory.

const Cut = Schema.Struct({ imageKey: Schema.NullOr(Schema.String) })
const work = { key: 'piece/pc_1', accountId: 'ac_1', provider: 'meta-sam', result: Cut }
const perAttempt = {
  hold: (attempt: number) => holdId('piece', 'pc_1', attempt),
  credits: 1,
  paidFor: (cut: typeof Cut.Type) => cut.imageKey !== null,
}

const over = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0)",
  )
  // A member, so the day brings the members' allowance; the account's 3 free credits are on top.
  database.sqlite.exec(
    "INSERT INTO memberships (account_id, plan, until, status, updated_at) VALUES ('ac_1', 'lifetime', NULL, 'active', 0)",
  )
  const wallet = Styld.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory))
  const kernel = Database.layer(database)
  const holds = Holds.layer.pipe(Layer.provide(Layer.merge(wallet, kernel)))
  const layer = Layer.mergeAll(holds, PaidAttempts.layer.pipe(Layer.provide(Layer.merge(holds, kernel))))
  /** Make the claim look as if its delivery took it `minutes` ago. */
  const age = (minutes: number) =>
    database.sqlite
      .prepare('UPDATE paid_attempts SET claimed_at = claimed_at - ? WHERE work = ?')
      .run(minutes * 60_000, work.key)
  return { layer, age }
}

/** A provider call that counts how often it is made. */
const counting = () => {
  let calls = 0
  return {
    calls: () => calls,
    cut: (imageKey: string | null) => Effect.sync(() => ((calls += 1), { imageKey })),
  }
}

/** A result made at a moment, kept as JSON. */
const made = { at: new Date(1_700_000_000_000) }

describe('a paid attempt', () => {
  it.effect('runs once and answers a repeat from its stored result, paying once', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      const attempts = yield* PaidAttempts
      const provider = counting()
      const first = yield* attempts.charged(work, perAttempt, provider.cut('cutout.png'))
      const repeat = yield* attempts.charged(work, perAttempt, provider.cut('again.png'))
      expect([first, repeat]).toEqual([{ imageKey: 'cutout.png' }, { imageKey: 'cutout.png' }])
      expect(provider.calls()).toBe(1)
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(allCredits - 1)
    }).pipe(Effect.provide(layer))
  })

  it.effect('keeps a result with dates as it was made', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      const attempts = yield* PaidAttempts
      const dated = { ...work, key: 'capture/cp_1/0', result: Schema.Struct({ at: Schema.Date }) }
      yield* attempts.run(dated, Effect.succeed(made))
      expect(yield* attempts.run(dated, Effect.die(new Error('asked again')))).toEqual(made)
    }).pipe(Effect.provide(layer))
  })

  it.effect('refunds an answer that made nothing', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      yield* (yield* PaidAttempts).charged(work, perAttempt, counting().cut(null))
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(allCredits)
    }).pipe(Effect.provide(layer))
  })

  it.effect('leaves the work to a live claim, and tries again as a new attempt after a busy provider', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      const attempts = yield* PaidAttempts
      const provider = counting()
      // A second delivery while the first still runs the work.
      const outer = yield* attempts.run(
        work,
        Effect.gen(function* () {
          const inner = yield* Effect.flip(attempts.run(work, provider.cut('inner.png')))
          expect(inner).toMatchObject({ _tag: 'AttemptElsewhere' })
          return yield* provider.cut('outer.png')
        }),
      )
      expect(outer).toEqual({ imageKey: 'outer.png' })
      expect(provider.calls()).toBe(1)
      // A busy provider took nothing: each delivery is a new attempt with its own hold, refunded.
      const other = { ...work, key: 'piece/pc_2' }
      const refused = yield* Effect.flip(attempts.charged(other, perAttempt, busy('meta-sam')))
      expect(refused).toMatchObject({ reason: { _tag: 'Busy' } })
      const second = yield* attempts.charged(other, perAttempt, provider.cut('cutout.png'))
      expect(second).toEqual({ imageKey: 'cutout.png' })
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(allCredits - 1)
    }).pipe(Effect.provide(layer))
  })

  it.effect('never sends again work whose answer was lost, and refunds it once its claim expires', () => {
    const { layer, age } = over()
    return Effect.gen(function* () {
      const attempts = yield* PaidAttempts
      const provider = counting()
      // The first delivery dies after the provider took the work: its answer is unknown, and its claim stays.
      const lost = yield* Effect.flip(attempts.charged(work, perAttempt, outcomeUnknown('meta-sam')))
      expect(lost).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
      const live = yield* Effect.flip(attempts.charged(work, perAttempt, provider.cut('cutout.png')))
      expect(live).toMatchObject({ _tag: 'AttemptElsewhere' })
      age(16)
      const expired = yield* Effect.flip(attempts.charged(work, perAttempt, provider.cut('cutout.png')))
      expect(expired).toMatchObject({ reason: { _tag: 'OutcomeUnknown' } })
      expect(provider.calls()).toBe(0)
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(allCredits)
    }).pipe(Effect.provide(layer))
  })
})
