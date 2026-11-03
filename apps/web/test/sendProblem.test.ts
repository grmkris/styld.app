import { LimitReached, SlowDown } from '@styld/protocol'
import { describe, expect, test } from 'vitest'
import { problemOf } from '../src/page/AddPieces/Commands.ts'

// A refused upload says why (STATUS open item, C8): uploads waiting unused and a send paced back are not the day's
// credits, and only the paced one is worth trying again at once.

describe('why sending a file stopped', () => {
  test('tells uploads waiting unused and a paced send from spent credits', () => {
    expect(problemOf(LimitReached.make({ limit: 'uploads' }))).toBe('uploadsWaiting')
    expect(problemOf(LimitReached.make({ limit: 'dailyCredits' }))).toBe('dailyLimit')
    expect(problemOf(SlowDown.make({}))).toBe('slowDown')
  })
})
