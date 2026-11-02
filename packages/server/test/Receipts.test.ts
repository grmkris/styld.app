import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Exit, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { identify, once, priorResult, receiptRow, receiptRows } from '../src/kernel/Receipts.ts'
import { localD1 } from './LocalD1.ts'

const asked = { accountId: 'ac_1', operationId: 'op-0001', command: 'createBoard', input: ['Summer'] }

/** The receipt an operation's batch writes, as the store would read it back. */
const stored = (operation: typeof asked) =>
  Effect.gen(function* () {
    const row = yield* receiptRow(yield* identify(operation), 'bd_1')
    return Option.some(row)
  })

describe('an operation id', () => {
  it.effect('answers a repeat of the same command and input with what it made', () =>
    Effect.gen(function* () {
      const prior = yield* priorResult(yield* identify(asked), yield* stored(asked))
      expect(prior).toEqual(Option.some('bd_1'))
    }),
  )

  it.effect('has nothing to answer before the operation ran', () =>
    Effect.gen(function* () {
      expect(yield* priorResult(yield* identify(asked), Option.none())).toEqual(Option.none())
    }),
  )

  it.effect('refuses another input or another command under the same id', () =>
    Effect.gen(function* () {
      const receipt = yield* stored(asked)
      const otherInput = yield* Effect.exit(priorResult(yield* identify({ ...asked, input: ['Winter'] }), receipt))
      const otherCommand = yield* Effect.exit(priorResult(yield* identify({ ...asked, command: 'addPins' }), receipt))
      expect(Exit.isFailure(otherInput) && Exit.isFailure(otherCommand)).toBe(true)
      expect(JSON.stringify(otherInput)).toContain('OperationConflict')
    }),
  )
})

/** Receipts in the migrated schema, as the stores keep them. */
const sqlReceipts = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0)",
  )
  return receiptRows(drizzle(database))
}

/** Work that counts its runs, answering what it made and the receipt's result. */
const counted = () => {
  let runs = 0
  return {
    runs: () => runs,
    answer: {
      replay: (result: string) => Effect.succeed(`again ${result}`),
      run: Effect.sync(() => {
        runs += 1
        return ['made up_1', 'up_1'] as const
      }),
    },
  }
}

describe('an operation answered once', () => {
  it.effect('does its work once and answers a repeat from its receipt', () =>
    Effect.gen(function* () {
      const receipts = sqlReceipts()
      const work = counted()
      expect(yield* once(receipts, asked, work.answer)).toBe('made up_1')
      expect(yield* once(receipts, asked, work.answer)).toBe('again up_1')
      expect(work.runs()).toBe(1)
      const conflict = yield* Effect.exit(once(receipts, { ...asked, input: ['Winter'] }, work.answer))
      expect(JSON.stringify(conflict)).toContain('OperationConflict')
      expect(work.runs()).toBe(1)
    }),
  )

  it.effect('claims its id before the work, so a repeat while it runs does not run it too', () =>
    Effect.gen(function* () {
      const receipts = sqlReceipts()
      const work = counted()
      const inner = yield* once(receipts, asked, {
        replay: work.answer.replay,
        run: Effect.map(
          Effect.exit(once(receipts, asked, work.answer)),
          (repeat) => [JSON.stringify(repeat), 'up_2'] as const,
        ),
      })
      expect(JSON.stringify(inner)).toContain('Unavailable')
      expect(work.runs()).toBe(0)
      expect(yield* once(receipts, asked, work.answer)).toBe('again up_2')
    }),
  )

  it.effect('frees its id when the work fails, for a repeat to run it', () =>
    Effect.gen(function* () {
      const receipts = sqlReceipts()
      const work = counted()
      const failed = yield* Effect.exit(once(receipts, asked, { ...work.answer, run: Effect.fail('refused') }))
      expect(Exit.isFailure(failed)).toBe(true)
      expect(yield* once(receipts, asked, work.answer)).toBe('made up_1')
    }),
  )

  it.effect('resumes, rather than runs again, paid work whose request died before it answered', () =>
    Effect.gen(function* () {
      const receipts = sqlReceipts()
      const work = counted()
      // A request claimed the id and died while its work ran.
      const pending = { ...(yield* receiptRow(yield* identify(asked), '')), result: null }
      expect(yield* receipts.claimReceipt(pending)).toBe(true)
      expect(JSON.stringify(yield* Effect.exit(once(receipts, asked, work.answer)))).toContain('Unavailable')
      yield* TestClock.adjust('3 minutes')
      const resume = Effect.succeed('as it stands')
      expect(yield* once(receipts, asked, { ...work.answer, resume })).toBe('as it stands')
      // Work that may run again does.
      expect(yield* once(receipts, asked, work.answer)).toBe('made up_1')
      expect(work.runs()).toBe(1)
    }),
  )

  it.effect("refuses to save a receipt over another operation's under the same id", () =>
    Effect.gen(function* () {
      const receipts = sqlReceipts()
      const own = yield* receiptRow(yield* identify(asked), 'bd_1')
      yield* receipts.saveReceipt(own)
      yield* receipts.saveReceipt(own)
      const other = yield* receiptRow(yield* identify({ ...asked, command: 'addPins' }), 'bd_1')
      expect(JSON.stringify(yield* Effect.exit(receipts.saveReceipt(other)))).toContain('OperationConflict')
    }),
  )
})
