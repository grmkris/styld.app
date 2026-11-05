import { describe, expect, test } from 'vitest'
import { questionSets, questionsOf, readAnswer } from './Questions.ts'

const { sleeves, sport } = questionSets
const answered = (question: string, choice: string, probability: number) => ({
  answers: { [question]: { choice, probabilities: { [choice]: probability } } },
})
const sleeve = (choice: string, probability: number) => readAnswer(sleeves, answered('sleeve', choice, probability))
const kind = (choice: string, probability: number) => readAnswer(sport, answered('kind', choice, probability))

describe('a stored short-sleeved top asked about its sleeves', () => {
  test('is asked the sleeve question by its own name', () => {
    expect(Object.keys(questionsOf(sleeves))).toEqual(['sleeve'])
    expect(Object.keys(questionsOf(sleeves).sleeve?.criteria ?? {})).toEqual(['short', 'long', 'none'])
  })

  test('moves to long sleeves or sleeveless on a sure answer', () => {
    expect(sleeve('long', 0.92)).toEqual({ choice: 'long', probability: 0.92, to: 'longSleeveTops', unsure: false })
    expect(sleeve('none', 0.7)).toEqual({ choice: 'none', probability: 0.7, to: 'sleevelessTops', unsure: false })
  })

  test('stays where it is on short sleeves, an unsure answer, or none at all', () => {
    expect(sleeve('short', 0.99)).toEqual({ choice: 'short', probability: 0.99, to: undefined, unsure: false })
    expect(sleeve('short', 0.5).unsure).toBe(true)
    expect(sleeve('long', 0.69)).toEqual({ choice: 'long', probability: 0.69, to: undefined, unsure: true })
    expect(sleeve('cap', 0.95)).toEqual({ choice: undefined, probability: 0.95, to: undefined, unsure: true })
    expect(readAnswer(sleeves, { answers: {} })).toEqual({
      choice: undefined,
      probability: 0,
      to: undefined,
      unsure: true,
    })
  })
})

describe('a stored sport top asked which kind of sportswear it is', () => {
  test('moves to sports bras, sport bottoms or tracksuits on a sure answer', () => {
    expect(kind('bra', 0.9)).toEqual({ choice: 'bra', probability: 0.9, to: 'sportsBras', unsure: false })
    expect(kind('bottom', 0.7)).toEqual({ choice: 'bottom', probability: 0.7, to: 'sportBottoms', unsure: false })
    expect(kind('tracksuit', 0.81).to).toBe('tracksuits')
  })

  test('stays where it is on a top, an unsure answer, not sport, or none at all', () => {
    expect(kind('top', 0.99)).toEqual({ choice: 'top', probability: 0.99, to: undefined, unsure: false })
    expect(kind('bottom', 0.69)).toEqual({ choice: 'bottom', probability: 0.69, to: undefined, unsure: true })
    // Not sport is only reported: Clef read race shirts out of sportswear the wrong way (3 November).
    expect(kind('notSport', 0.97)).toEqual({ choice: 'notSport', probability: 0.97, to: undefined, unsure: true })
    expect(kind('swimwear', 0.95)).toEqual({ choice: undefined, probability: 0.95, to: undefined, unsure: true })
  })
})
