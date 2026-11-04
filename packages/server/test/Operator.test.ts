import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Option } from 'effect'
import { isOperator, operatorDigestOf } from '../src/Operator.ts'

// The operator's token at the edge of the operator's routes: only the stage's own token admits, a stage without one
// has no operator, and a token too short to be a random secret stops the Worker rather than guarding anything.

const token = 'an-operator-token-of-forty-three-or-more-characters'

describe("the operator's token", () => {
  it.effect('admits exactly the stage’s own token', () =>
    Effect.gen(function* () {
      const operator = Option.some(yield* operatorDigestOf(token))
      expect(yield* isOperator(operator, token)).toBe(true)
      expect(yield* isOperator(operator, `${token}x`)).toBe(false)
      expect(yield* isOperator(operator, token.slice(0, -1))).toBe(false)
      expect(yield* isOperator(operator, '')).toBe(false)
    }),
  )

  it.effect('admits nobody on a stage without a token', () =>
    Effect.gen(function* () {
      expect(yield* isOperator(Option.none(), token)).toBe(false)
      expect(yield* isOperator(Option.none(), '')).toBe(false)
    }),
  )

  it.effect('refuses a token too short to be a secret', () =>
    Effect.gen(function* () {
      expect(Exit.isFailure(yield* Effect.exit(operatorDigestOf('short-token')))).toBe(true)
    }),
  )
})
