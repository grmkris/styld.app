import { type Colour, PieceId, type PieceType } from '@styld/protocol'
import { describe, expect, test } from 'vitest'
import { analysisOf } from '../src/stylist/Analysis.ts'

// "Analyze my wardrobe" (Eva's review, T-14): the server's counts and its first rules for too much and too little.

let made = 0
const piece = (type: PieceType, colours: ReadonlyArray<Colour> = []) => ({
  id: PieceId.make(`pc_${String(made++).padStart(22, '0')}`),
  type,
  colours,
})
const repeat = <A>(count: number, make: () => A) => Array.from({ length: count }, make)

describe('the wardrobe’s analysis', () => {
  test('counts every group, type and colour exactly, commonest first', () => {
    const pieces = [
      piece('shortSleeveTops', ['white']),
      piece('shortSleeveTops', ['white', 'navy']),
      piece('jeans', ['blue']),
      piece('trainers', ['white']),
      piece('bags', ['black']),
    ]
    const analysis = analysisOf(pieces, { days: 60, pieceIds: [] })
    expect(analysis.pieces).toBe(5)
    expect(analysis.groups).toEqual([
      { group: 'clothing', count: 3 },
      { group: 'shoes', count: 1 },
      { group: 'accessories', count: 1 },
    ])
    expect(analysis.types[0]).toEqual({ type: 'shortSleeveTops', count: 2 })
    expect(analysis.colours[0]).toEqual({ colour: 'white', count: 3 })
    expect(analysis.colours.map(({ count }) => count).reduce((a, b) => a + b)).toBe(6)
  })

  test('what was worn: days per piece, the most worn first, never-worn pieces, and only the person’s own', () => {
    const [knit, jeans, boots] = [piece('knitwear'), piece('jeans'), piece('boots')]
    const worn = [knit.id, jeans.id, knit.id, knit.id, jeans.id, 'pc_someoneelse00000000000']
    const analysis = analysisOf([knit, jeans, boots], { days: 60, pieceIds: worn })
    expect(analysis.worn).toEqual({
      days: 60,
      pieces: 2,
      never: 1,
      most: [
        { pieceId: knit.id, days: 3 },
        { pieceId: jeans.id, days: 2 },
      ],
    })
  })

  test('too little: fewer than a working wardrobe needs, dresses and accessories never a gap', () => {
    const analysis = analysisOf([...repeat(6, () => piece('shortSleeveTops')), piece('jeans'), piece('trainers')], {
      days: 60,
      pieceIds: [],
    })
    expect(analysis.gaps).toEqual(['bottoms', 'layers', 'shoes'])
    expect(analysisOf([], { days: 60, pieceIds: [] }).gaps).toEqual(['tops', 'bottoms', 'layers', 'shoes'])
  })

  test('too much: an area past its share of the everyday pieces, only once the wardrobe has ten', () => {
    const tops = repeat(12, () => piece('shortSleeveTops'))
    const rest = [
      ...repeat(3, () => piece('trousers')),
      ...repeat(2, () => piece('coats')),
      ...repeat(3, () => piece('boots')),
    ]
    // Twelve tops of twenty everyday pieces is 60%, past 55%; sportswear is worn on its own and weighs nothing.
    const analysis = analysisOf([...tops, ...rest, ...repeat(5, () => piece('sportswear'))], { days: 60, pieceIds: [] })
    expect(analysis.surpluses).toEqual(['tops'])
    expect(analysis.gaps).toEqual([])
    expect(
      analysisOf(
        repeat(9, () => piece('shortSleeveTops')),
        { days: 60, pieceIds: [] },
      ).surpluses,
    ).toEqual([])
  })
})
