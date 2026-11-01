import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Option } from 'effect'
import { identify, priorResult, receiptRow } from '../src/kernel/Receipts.ts'

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
