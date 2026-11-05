import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Exit, Logger, Option, References } from 'effect'
import { called } from '../src/kernel/Bindings.ts'
import { fenced, query, reasonOf, refusedByConstraint, stored } from '../src/kernel/Db.ts'

// How a D1 call fails: a store that does not answer keeps its cause and the operation that asked, for one log line,
// and answers clients a bare `Unavailable`; a row a constraint refuses is a defect unless the write is fenced by it.

/** D1's error as Drizzle wraps it: the statement in Drizzle's message, SQLite's in the cause. */
const rejection = (message: string) => {
  const d1 = new Error(`D1_ERROR: ${message}`)
  return new Error('Failed query: insert into "uploads" ("id") values (?)', { cause: d1 })
}
const notNull = rejection('NOT NULL constraint failed: uploads.status: SQLITE_CONSTRAINT')
const lost = rejection('Network connection lost.')

type Logged = { readonly message: unknown; readonly annotations: Readonly<Record<string, unknown>> }

/** Run with the log lines it writes kept. */
const logging = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const logged: Array<Logged> = []
    const capture = Logger.make((options) => {
      logged.push({ message: options.message, annotations: options.fiber.getRef(References.CurrentLogAnnotations) })
    })
    const exit = yield* Effect.exit(effect.pipe(Effect.provide(Logger.layer([capture]))))
    return { exit, logged }
  })

describe('a D1 rejection', () => {
  it('is a refusal by a constraint only when SQLite names one', () => {
    expect(refusedByConstraint(notNull)).toBe(true)
    expect(refusedByConstraint(rejection('UNIQUE constraint failed: operation_receipts.account_id'))).toBe(true)
    expect(refusedByConstraint(rejection('FOREIGN KEY constraint failed'))).toBe(true)
    expect(refusedByConstraint(lost)).toBe(false)
    expect(refusedByConstraint('not an error')).toBe(false)
  })

  it('is logged by its kind, never its message', () => {
    expect(reasonOf(notNull)).toBe('SQLITE_CONSTRAINT')
    expect(reasonOf(lost)).toBe('D1_ERROR')
    expect(reasonOf(new Error('Network connection lost.'))).toBe('network-lost')
    expect(reasonOf(new Error('the query timed out'))).toBe('timeout')
    expect(reasonOf(new Error("values ('secret@example.com')"))).toBe('unknown')
  })
})

describe('a store call', () => {
  it.effect('that does not answer is unavailable, with its cause and the operation that asked', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(query(() => Promise.reject(lost)).pipe(Effect.withSpan('Styld.Test.read')))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isSuccess(exit)) return
      const error = Cause.findErrorOption(exit.cause)
      if (Option.isNone(error)) return expect.unreachable()
      expect(error.value).toMatchObject({ _tag: 'StoreUnavailable', operation: 'Styld.Test.read', cause: lost })
    }),
  )

  it.effect('refused by a constraint is a defect', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(query(() => Promise.reject(notNull)))
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    }),
  )

  it.effect('fenced by its constraints is unavailable when one refuses it, for the caller to answer', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(fenced(() => Promise.reject(notNull)).pipe(Effect.withSpan('Styld.Test.spend')))
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false)
      if (Exit.isSuccess(exit)) return expect.unreachable()
      const error = Cause.findErrorOption(exit.cause)
      if (Option.isNone(error)) return expect.unreachable()
      expect(error.value).toMatchObject({ _tag: 'StoreUnavailable', operation: 'Styld.Test.spend', cause: notNull })
    }),
  )

  it.effect('answered to a client is logged once and answers a bare Unavailable', () =>
    Effect.gen(function* () {
      const { exit, logged } = yield* logging(
        stored(query(() => Promise.reject(lost))).pipe(Effect.withSpan('Styld.Test.answer')),
      )
      if (Exit.isSuccess(exit)) return expect.unreachable()
      const error = Cause.findErrorOption(exit.cause)
      if (Option.isNone(error)) return expect.unreachable()
      expect(error.value).toMatchObject({ _tag: 'Unavailable' })
      expect(Object.keys(error.value)).not.toContain('cause')
      expect(logged).toHaveLength(1)
      expect(logged[0]?.annotations).toMatchObject({
        'styld.store.operation': 'Styld.Test.answer',
        'styld.store.reason': 'D1_ERROR',
      })
    }),
  )
})

describe('a binding call', () => {
  it.effect('that rejects is logged by its error name and answers Unavailable', () =>
    Effect.gen(function* () {
      const { exit, logged } = yield* logging(
        called(() => Promise.reject(new TypeError('accounts/ac_1/piece.png'))).pipe(Effect.withSpan('Styld.Test.r2')),
      )
      if (Exit.isSuccess(exit)) return expect.unreachable()
      const error = Cause.findErrorOption(exit.cause)
      if (Option.isNone(error)) return expect.unreachable()
      expect(error.value).toMatchObject({ _tag: 'Unavailable' })
      expect(logged[0]?.annotations).toMatchObject({
        'styld.binding.operation': 'Styld.Test.r2',
        'styld.binding.reason': 'TypeError',
      })
    }),
  )
})
