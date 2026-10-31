import { Option } from 'effect'
import { describe, expect, test } from 'vitest'
import { planOf } from '../src/generation/Planner.ts'

const wardrobe = [
  { ref: 'p1', name: 'Navy knit', category: 'top', colours: ['navy'] },
  { ref: 'p2', name: 'Raincoat', category: 'outerwear', colours: ['yellow'] },
]
const request = { sentence: 'Rainy Sunday in the city', wardrobe, most: 3 }
const picture = (prompt: string, pieces: ReadonlyArray<string> = []) => ({ prompt, pieces })

describe('planning a mood board', () => {
  test('keeps only the person’s own pieces, two to a picture, and moods from the list', () => {
    const plan = planOf(
      {
        refuse: false,
        pictures: [picture('Wet cobbles at dusk', ['p2', 'p9', 'p1', 'p2']), picture('A steaming cup', [])],
        picks: ['p1', 'p1', 'p7', 'p2'],
        moods: ['rain', 'gloomy', 'weekend', 'rain'],
      },
      request,
    )
    expect(plan).toEqual(
      Option.some({
        pictures: [picture('Wet cobbles at dusk', ['p2', 'p1']), picture('A steaming cup')],
        picks: ['p1', 'p2'],
        moods: ['rain', 'weekend'],
      }),
    )
  })

  test('never plans more pictures than credits are held, nor fewer than two', () => {
    const four = ['a', 'b', 'c', 'd'].map((prompt) => picture(prompt))
    const plan = planOf({ refuse: false, pictures: four, picks: [], moods: [] }, request)
    expect(Option.map(plan, ({ pictures }) => pictures.length)).toEqual(Option.some(3))
    expect(planOf({ refuse: false, pictures: [picture('only one')], picks: [], moods: [] }, request)).toEqual(
      Option.none(),
    )
  })

  test('a refusal plans nothing, whatever else the answer holds', () => {
    expect(
      planOf({ refuse: true, pictures: [picture('a'), picture('b')], picks: ['p1'], moods: ['rain'] }, request),
    ).toEqual(Option.none())
  })
})
