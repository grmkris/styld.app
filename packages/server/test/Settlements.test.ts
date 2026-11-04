import * as Domain from '@alchemy.run/domain'
import { describe, expect, it } from '@effect/vitest'
import { freeCredits, memberDailyCredits } from '@styld/protocol'
import { Styld } from '@styld/domain/Styld.model'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Exit, Layer } from 'effect'
import { Database, nowDate } from '../src/kernel/Db.ts'
import { holdId, Holds, settlementRows } from '../src/usage/Holds.ts'
import { memberD1 } from './LocalD1.ts'

/** A member's credits on a fresh day: the day's allowance and the free credits. */
const allCredits = memberDailyCredits + freeCredits

// Every hold is kept in D1 from before it is reserved until the Wallet confirms it settled, so a settlement the Wallet
// could not take, or one whose work was lost before it ended, is settled by the sweep whatever became of the work's own
// rows. The Wallet here is the real aggregate, hosted in memory.

const hourMillis = 60 * 60 * 1000

const over = () => {
  // A member, so the day brings the members' allowance; the account's 3 free credits are on top.
  const database = memberD1()
  const wallet = Styld.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory))
  const layer = Holds.layer.pipe(Layer.provide(Layer.mergeAll(wallet, Database.layer(database))))
  const kept = () => database.sqlite.prepare('SELECT hold_id, ending FROM pending_settlements ORDER BY hold_id').all()
  /** Make a kept hold look as if it was last touched `hours` ago. */
  const age = (hold: string, hours: number) =>
    database.sqlite
      .prepare('UPDATE pending_settlements SET updated_at = ? WHERE hold_id = ?')
      .run(Date.now() - hours * hourMillis, hold)
  return { layer, kept, age, database, ledger: settlementRows(drizzle(database)) }
}

const first = holdId('piece', 'pc_1', 1)
const second = holdId('piece', 'pc_2', 1)

describe('the credit ledger', () => {
  it.effect('refuses a settled reservation receipt as permission for more paid work', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      yield* holds.reserve({ accountId: 'ac_1', hold: first, credits: 2 })
      yield* holds.settle('ac_1', first, 'failed')
      expect(yield* Effect.flip(holds.reserve({ accountId: 'ac_1', hold: first, credits: 2 }))).toMatchObject({
        _tag: 'Unavailable',
      })
      expect(yield* holds.remaining('ac_1')).toBe(allCredits)
    }).pipe(Effect.provide(layer))
  })

  it.effect('keeps and settles an outstanding hold after its account rows are deleted', () => {
    const { layer, kept, database, ledger } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      yield* holds.reserve({ accountId: 'ac_1', hold: first, credits: 2 })
      database.sqlite.exec("DELETE FROM accounts WHERE id = 'ac_1'")
      expect(kept()).toEqual([{ hold_id: first, ending: null }])
      yield* ledger.end('ac_1', first, 'failed', yield* nowDate)
      yield* holds.sweep
      expect(kept()).toEqual([])
      expect(yield* holds.remaining('ac_1')).toBe(allCredits)
    }).pipe(Effect.provide(layer))
  })
  it.effect('keeps a hold from before it is reserved until the Wallet settled it', () => {
    const { layer, kept } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      yield* holds.reserve({ accountId: 'ac_1', hold: first, credits: 2 })
      expect(kept()).toEqual([{ hold_id: first, ending: null }])
      expect(yield* holds.remaining('ac_1')).toBe(allCredits - 2)
      yield* holds.settle('ac_1', first, 'succeeded')
      expect(kept()).toEqual([])
      expect(yield* holds.remaining('ac_1')).toBe(allCredits - 2)
    }).pipe(Effect.provide(layer))
  })

  it.effect('settles by the first ending recorded, when the Wallet did not take it at the time', () => {
    const { layer, kept, ledger } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      yield* holds.reserve({ accountId: 'ac_1', hold: first, credits: 3 })
      // The work failed and its refund was recorded, but the call to the Wallet was lost; a later success stays second.
      const at = yield* nowDate
      expect(yield* ledger.end('ac_1', first, 'failed', at)).toBe('failed')
      expect(yield* ledger.end('ac_1', first, 'succeeded', at)).toBe('failed')
      expect(yield* holds.sweep).toBe(1)
      expect(kept()).toEqual([])
      expect(yield* holds.remaining('ac_1')).toBe(allCredits)
    }).pipe(Effect.provide(layer))
  })

  it.live('refunds a hold whose work never ended once it is abandoned, and leaves a recent one to its work', () => {
    const { layer, kept, age } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      yield* holds.reserve({ accountId: 'ac_1', hold: first, credits: 4 })
      yield* holds.reserve({ accountId: 'ac_1', hold: second, credits: 1 })
      age(first, 7)
      age(second, 1)
      expect(yield* holds.sweep).toBe(1)
      expect(kept()).toEqual([{ hold_id: second, ending: null }])
      expect(yield* holds.remaining('ac_1')).toBe(allCredits - 1)
    }).pipe(Effect.provide(layer))
  })

  it.effect('keeps nothing for a hold the Wallet refused, or one settled that was never held', () => {
    const { layer, kept } = over()
    return Effect.gen(function* () {
      const holds = yield* Holds
      const refused = yield* Effect.exit(holds.reserve({ accountId: 'ac_1', hold: first, credits: allCredits + 1 }))
      expect(Exit.isFailure(refused)).toBe(true)
      yield* holds.settle('ac_1', second, 'failed')
      expect(kept()).toEqual([])
    }).pipe(Effect.provide(layer))
  })
})
