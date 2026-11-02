import { outcomeUnknown } from '../src/providers/Errors.ts'
import { describe, expect, it } from '@effect/vitest'
import { Cause, Schema } from 'effect'
import { failedEnding, holdId, settlementOf } from '../src/usage/Holds.ts'

class Refused extends Schema.TaggedError<Refused>()('Refused', {}) {}

describe('a settlement', () => {
  it('consumes only work that succeeded, and refunds a known failure and a lost provider answer alike', () => {
    expect(settlementOf('succeeded')).toBe('consumed')
    expect(settlementOf(failedEnding(Cause.fail(Refused.make({}))))).toBe('refunded')
    expect(failedEnding(Cause.fail(outcomeUnknown('meta-sam')))).toBe('unknown')
    expect(settlementOf('unknown')).toBe('refunded')
  })
})

describe('a hold id', () => {
  it('names what it pays for and the attempt, so a retry never reuses a settled hold', () => {
    expect(holdId('capture', 'cp_1', 0)).toBe('capture/cp_1/0')
    expect(holdId('capture', 'cp_1', 1)).not.toBe(holdId('capture', 'cp_1', 0))
  })
})
