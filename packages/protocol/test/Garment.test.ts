import { describe, expect, test } from 'vitest'
import { familyOf, GarmentGroup, groupOf, PieceType, typesIn } from '../src/Garment.ts'

describe('the wardrobe’s groups', () => {
  test('open as a shop’s sections, Tops and Bottoms first (Eva, 5 November)', () => {
    expect(GarmentGroup.literals).toEqual([
      'tops',
      'bottoms',
      'dresses',
      'outerwear',
      'sport',
      'swimLounge',
      'shoes',
      'accessories',
    ])
    expect(typesIn('tops')).toEqual([
      'shortSleeveTops',
      'longSleeveTops',
      'sleevelessTops',
      'shirts',
      'bodysuits',
      'knitwear',
      'hoodies',
    ])
    expect(typesIn('bottoms')).toEqual(['jeans', 'trousers', 'shorts', 'skirts'])
  })

  test('hold every type exactly once, and no group is empty', () => {
    const listed = GarmentGroup.literals.flatMap((group) => typesIn(group))
    expect(listed.toSorted()).toEqual([...PieceType.literals].toSorted())
    for (const group of GarmentGroup.literals) expect(typesIn(group).length).toBeGreaterThan(0)
  })

  test('keep the coarse family decisions use: everyday clothes, sport, shoes, accessories', () => {
    expect(familyOf('shortSleeveTops')).toBe('clothing')
    expect(familyOf('jeans')).toBe('clothing')
    expect(familyOf('coats')).toBe('clothing')
    expect(familyOf('swimwear')).toBe('clothing')
    expect(familyOf('sportBottoms')).toBe('sport')
    expect(familyOf('sportShoes')).toBe('sport')
    expect(familyOf('trainers')).toBe('shoes')
    expect(familyOf('bags')).toBe('accessories')
    expect(groupOf('dresses')).toBe('dresses')
  })
})
