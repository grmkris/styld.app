import { describe, expect, test } from 'vitest'
import { sportRead } from './Sport.ts'

const answered = (choice: string, probability: number) => ({
  answers: { kind: { choice, probabilities: { [choice]: probability } } },
})

describe('a stored sport top asked which kind of sportswear it is', () => {
  test('moves to sports bras, sport bottoms or tracksuits on a sure answer', () => {
    expect(sportRead(answered('bra', 0.9))).toEqual({ kind: 'bra', probability: 0.9, to: 'sportsBras' })
    expect(sportRead(answered('bottom', 0.7))).toEqual({ kind: 'bottom', probability: 0.7, to: 'sportBottoms' })
    expect(sportRead(answered('tracksuit', 0.81)).to).toBe('tracksuits')
  })

  test('stays where it is on a top, an unsure answer, not sport, or none at all', () => {
    expect(sportRead(answered('top', 0.99)).to).toBeUndefined()
    expect(sportRead(answered('bottom', 0.69))).toEqual({ kind: 'bottom', probability: 0.69, to: undefined })
    // Not sport is only reported: Clef read race shirts out of sportswear the wrong way (3 November).
    expect(sportRead(answered('notSport', 0.97))).toEqual({ kind: 'notSport', probability: 0.97, to: undefined })
    expect(sportRead(answered('swimwear', 0.95))).toEqual({ kind: undefined, probability: 0.95, to: undefined })
    expect(sportRead({ answers: {} })).toEqual({ kind: undefined, probability: 0, to: undefined })
  })
})
