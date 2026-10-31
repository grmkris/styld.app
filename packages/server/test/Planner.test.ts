import { Option } from 'effect'
import { describe, expect, test } from 'vitest'
import { mostPicks, planOf } from '../src/generation/Planner.ts'

const wardrobe = [
  { ref: 'p1', name: 'Navy knit', category: 'top', colours: ['navy'] },
  { ref: 'p2', name: 'Raincoat', category: 'outerwear', colours: ['yellow'] },
  { ref: 'p3', name: 'Wellies', category: 'shoes', colours: ['black'] },
]
const request = { sentence: 'Rainy Sunday in the city', wardrobe }

describe('planning a mood board from the person’s pieces', () => {
  test('keeps only the person’s own pieces, once each, and moods from the list', () => {
    expect(
      planOf({ refuse: false, picks: ['p1', 'p1', 'p7', 'p2'], moods: ['rain', 'gloomy', 'weekend', 'rain'] }, request),
    ).toEqual(Option.some({ picks: ['p1', 'p2'], moods: ['rain', 'weekend'] }))
  })

  test('needs at least two of the person’s pieces, and keeps no more than the most a board takes', () => {
    expect(planOf({ refuse: false, picks: ['p1', 'p9'], moods: [] }, request)).toEqual(Option.none())
    const many = Array.from({ length: mostPicks + 4 }, (_, at) => ({
      ref: `p${at + 1}`,
      name: 'Tee',
      category: 'top',
      colours: [],
    }))
    const plan = planOf(
      { refuse: false, picks: many.map(({ ref }) => ref), moods: [] },
      { sentence: 'Summer', wardrobe: many },
    )
    expect(Option.map(plan, ({ picks }) => picks.length)).toEqual(Option.some(mostPicks))
  })

  test('a refusal plans nothing, whatever else the answer holds', () => {
    expect(planOf({ refuse: true, picks: ['p1', 'p2'], moods: ['rain'] }, request)).toEqual(Option.none())
  })
})
