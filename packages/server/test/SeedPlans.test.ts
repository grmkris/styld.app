import { describe, expect, it } from '@effect/vitest'
import {
  boardHeight,
  boardWidth,
  OperationId,
  PieceId,
  type PieceType,
  type SeedBoard,
  type SeedBoardRequest,
  TableLabel,
  TablePiece,
} from '@styld/protocol'
import { Effect, Exit, Option, Schema } from 'effect'
import type { Wearable } from '../src/outfits/Rules.ts'
import { digestsOf, planOf, stepOf, tablePart } from '../src/seed/Boarding.ts'
import { outfitsOf, tableOf } from '../src/seed/Tables.ts'

// A house board's table and outfits (owner, 4 November 2026): laid out by the app's own layouts from the board's own
// pieces, and the same entry always gives the same outfits, so seeding again changes nothing.

const isLabel = Schema.is(TableLabel)
const isPiece = Schema.is(TablePiece)

let made = 0
const garment = (type: PieceType, colours: Wearable['colours'] = ['navy']): Wearable => {
  made += 1
  return {
    id: PieceId.make(`pc_${String(made).padStart(22, '0')}`),
    type,
    colours,
    seasons: [],
    rainproof: false,
    occasions: [],
    pattern: 'plain',
    name: null,
    drawn: true,
  }
}

const wardrobe = [
  garment('shirts', ['white']),
  garment('shortSleeveTops', ['black']),
  garment('knitwear', ['beige']),
  garment('trousers', ['beige']),
  garment('jeans', ['blue']),
  garment('skirts', ['brown']),
  garment('trainers', ['white']),
  garment('loafers', ['black']),
  garment('bags', ['brown']),
  garment('scarves', ['blue']),
]

const onTable = ({ x, y, size }: { x: number; y: number; size: number }) =>
  x - size / 2 >= -1e-6 &&
  y - size / 2 >= -1e-6 &&
  x + size / 2 <= boardWidth + 1e-6 &&
  y + size / 2 <= boardHeight + 1e-6

const entry = (board: Partial<SeedBoard>): SeedBoardRequest => ({
  operationId: OperationId.make('seed-test-0001'),
  email: 'house@styld.test',
  version: 1,
  board: {
    name: 'Lisbon, 5 days',
    build: 'outfits',
    paper: 'sand',
    moods: ['weekend'],
    labels: [],
    pieces: wardrobe.map(({ id }) => id),
    tags: [{ kind: 'audience', value: 'women' }],
    sl: { name: 'Lizbona, 5 dni', review: 'pending' },
    ...board,
  },
})
const byManifest = new Map(wardrobe.map((piece) => [piece.id, piece] as const))

describe('a house board’s outfits', () => {
  it('are the same for the same seed, different from each other, and only the board’s own pieces', () => {
    const first = outfitsOf(wardrobe, 4, 'w-lisbon-5d:1', {})
    expect(outfitsOf(wardrobe, 4, 'w-lisbon-5d:1', {})).toEqual(first)
    expect(first).toHaveLength(4)
    expect(new Set(first.map((outfit) => outfit.toSorted().join())).size).toBe(4)
    const own = new Set(wardrobe.map(({ id }) => id))
    expect(first.flat().every((id) => own.has(id))).toBe(true)
  })

  it('around an anchor all wear it', () => {
    const [anchor] = wardrobe
    if (anchor === undefined) throw new Error('no anchor')
    const outfits = outfitsOf(wardrobe, 6, 'w-white-shirt-8:1', { anchor })
    expect(outfits.every((outfit) => outfit.includes(anchor.id))).toBe(true)
  })

  it('are fewer than asked when the pieces make no more', () => {
    expect(outfitsOf(wardrobe.slice(0, 2), 3, 'thin:1', {}).length).toBeLessThan(3)
  })
})

describe('a house board’s table', () => {
  const labels = [{ text: '12 pieces · 8 outfits', style: 'label' as const, sl: '12 kosov · 8 videzov' }]

  it('a packing list puts every piece on the board, the text above them', () => {
    const things = tableOf('pack', wardrobe, [], labels)
    expect(things).toHaveLength(wardrobe.length + 1)
    expect(things.filter(({ thing }) => isPiece(thing)).every(onTable)).toBe(true)
    const [text] = things.filter(({ thing }) => isLabel(thing))
    const lowest = Math.min(...things.filter(({ thing }) => isPiece(thing)).map(({ y, size }) => y - size / 2))
    expect(text?.y ?? Infinity).toBeLessThan(lowest)
  })

  it('outfits lay out every piece of each, on the board', () => {
    const outfits = [wardrobe.slice(0, 4), wardrobe.slice(4, 8)]
    const things = tableOf('outfits', wardrobe, outfits, labels)
    expect(things.filter(({ thing }) => isPiece(thing))).toHaveLength(8)
    expect(things.filter(({ thing }) => isPiece(thing)).every(onTable)).toBe(true)
  })
})

describe('a house board’s plan', () => {
  it.effect('an outfits board gets as many outfits as it asks for', () =>
    Effect.gen(function* () {
      const plan = yield* planOf('w-lisbon-5d', entry({ outfits: 3 }), byManifest)
      expect(plan.outfits).toHaveLength(3)
      expect(Option.isNone(plan.anchor)).toBe(true)
    }),
  )

  it.effect('a one-piece board needs its anchor and layout, and has no texts', () =>
    Effect.gen(function* () {
      const without = yield* Effect.exit(planOf('w-x', entry({ build: 'onePiece' }), byManifest))
      expect(Exit.isFailure(without)).toBe(true)
      const texted = entry({
        build: 'onePiece',
        anchor: wardrobe[0]?.id ?? '',
        layout: 'flanking',
        labels: [{ text: 'Hi', style: 'label', sl: 'Živjo' }],
      })
      expect(Exit.isFailure(yield* Effect.exit(planOf('w-x', texted, byManifest)))).toBe(true)
    }),
  )

  it.effect('too few pieces for the outfits asked refuses the entry by its id', () =>
    Effect.gen(function* () {
      const thin = new Map([...byManifest].slice(0, 2))
      const refused = yield* Effect.flip(planOf('w-thin', entry({ pieces: [...thin.keys()], outfits: 3 }), thin))
      expect(refused).toMatchObject({ _tag: 'SeedRefused', reason: 'noOutfits', detail: ['w-thin'] })
    }),
  )
})

describe('a house board’s steps', () => {
  it.effect('take the same operation ids for the same entry, valid ones, and new ones when it changes', () =>
    Effect.gen(function* () {
      const id = yield* stepOf('w-lisbon-5d', 'create', 1, 'abc.def')
      expect(Schema.is(OperationId)(id)).toBe(true)
      expect(yield* stepOf('w-lisbon-5d', 'create', 1, 'abc.def')).toBe(id)
      expect(yield* stepOf('w-lisbon-5d', 'create', 1, 'abc.xyz')).not.toBe(id)
    }),
  )

  it.effect('keep the table’s digest when only the name, tags or Slovenian change', () =>
    Effect.gen(function* () {
      const before = yield* digestsOf(entry({}))
      const renamed = yield* digestsOf(entry({ name: 'Lisbon, five days', sl: { name: 'Lizbona', review: 'pending' } }))
      expect(tablePart(renamed)).toBe(tablePart(before))
      expect(renamed).not.toBe(before)
      const relaid = yield* digestsOf(entry({ outfits: 4 }))
      expect(tablePart(relaid)).not.toBe(tablePart(before))
    }),
  )
})
