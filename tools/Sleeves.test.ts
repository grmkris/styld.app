import { describe, expect, test } from 'vitest'
import { sleeveRead } from './Sleeves.ts'

const answered = (choice: string, probability: number) => ({
  answers: { sleeve: { choice, probabilities: { [choice]: probability } } },
})

describe('a stored short-sleeved top asked about its sleeves', () => {
  test('moves to long sleeves or sleeveless on a sure answer', () => {
    expect(sleeveRead(answered('long', 0.92))).toEqual({ sleeve: 'long', probability: 0.92, to: 'longSleeveTops' })
    expect(sleeveRead(answered('none', 0.7))).toEqual({ sleeve: 'none', probability: 0.7, to: 'sleevelessTops' })
  })

  test('stays where it is on short sleeves, an unsure answer, or none at all', () => {
    expect(sleeveRead(answered('short', 0.99)).to).toBeUndefined()
    expect(sleeveRead(answered('long', 0.69))).toEqual({ sleeve: 'long', probability: 0.69, to: undefined })
    expect(sleeveRead(answered('cap', 0.95))).toEqual({ sleeve: undefined, probability: 0.95, to: undefined })
    expect(sleeveRead({ answers: {} })).toEqual({ sleeve: undefined, probability: 0, to: undefined })
  })
})
