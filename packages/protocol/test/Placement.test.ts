import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  arranged,
  type BoardItem,
  BoardItemId,
  boardHeight,
  boardWidth,
  landed,
  landing,
  PieceId,
  PieceItem,
  piecesOnTable,
  raised,
  stepped,
  TableLabel,
  TablePiece,
  TextItem,
  tidied,
  widestLabel,
} from '../src/index.ts'

const itemId = (seed: string) => Schema.decodeUnknownSync(BoardItemId)(`bi_${seed.padEnd(22, 'x')}`)
const pieceId = (seed: string) => Schema.decodeUnknownSync(PieceId)(`pc_${seed.padEnd(22, 'x')}`)

const at = { x: 500, y: 600, size: 400, turn: 0, flipped: false }
const piece = (seed: string, z: number): BoardItem =>
  PieceItem.make({ id: itemId(seed), pieceId: pieceId(seed), ...at, z })
const label = (seed: string, z: number): BoardItem =>
  TextItem.make({ id: itemId(seed), text: 'Rain', style: 'label', ...at, z })

/** Put n things on the table one after another, each where the next one lands. */
const laidOut = (count: number): ReadonlyArray<BoardItem> =>
  Array.from({ length: count }).reduce<ReadonlyArray<BoardItem>>(
    (items, _, index) => [...items, { ...piece(`p${index}`, 0), ...landing(items, 380) }],
    [],
  )

const onTheSheet = (item: BoardItem) =>
  item.x >= 0 && item.x <= boardWidth && item.y >= 0 && item.y <= boardHeight && item.turn > -180 && item.turn <= 180

describe('where things land on a table', () => {
  test('the first pieces take an outfit’s places, each new one on top', () => {
    const items = laidOut(4)
    expect(items.map(({ x, y }) => [x, y])).toEqual([
      [290, 320],
      [720, 300],
      [320, 860],
      [735, 945],
    ])
    expect(items.map(({ z }) => z)).toEqual([1, 2, 3, 4])
  })

  test('the same table always lays the next piece in the same place', () => {
    expect(landing(laidOut(9), 380)).toEqual(landing(laidOut(9), 380))
  })

  test('a full table keeps landing on the sheet', () => {
    expect(laidOut(60).every(onTheSheet)).toBe(true)
  })
})

describe('tidying a table', () => {
  test('lays every item on the sheet in stacking order, without losing one', () => {
    const items = [piece('a', 3), piece('b', 1), label('c', 2)]
    const tidy = tidied(items)
    expect(tidy.map(({ id }) => id)).toEqual(items.map(({ id }) => id))
    expect(tidy.every(onTheSheet)).toBe(true)
    expect(tidy.map(({ x, y }) => [x, y])).toEqual([
      [750, 685],
      [250, 685],
      [500, 60],
    ])
  })

  test('a mood board’s pieces arranged around a label keep its words on the sheet (browser review, 2 November)', () => {
    // The review's board: three pinned pieces and a long label, then five pieces a mood board added, tidied.
    const long = TextItem.make({
      id: itemId('label'),
      text: 'C8 — večerja v mestu',
      style: 'label',
      ...at,
      size: 520,
      z: 4,
    })
    const items = [
      piece('a', 1),
      piece('b', 2),
      piece('c', 3),
      long,
      ...['d', 'e', 'f', 'g', 'h'].map((seed, index) => piece(seed, 5 + index)),
    ]
    const tidy = tidied(items)
    const placedLabel = tidy.find(({ id }) => id === long.id)
    // Centred, and no larger than a label drawn within 90% of the table's width.
    expect(placedLabel).toMatchObject({ x: boardWidth / 2, size: widestLabel, turn: 0 })
    const others = tidy.filter(({ id }) => id !== long.id)
    expect(others.every(({ y, size }) => y - size / 2 >= (placedLabel?.y ?? 0))).toBe(true)
    expect(tidy.every(onTheSheet)).toBe(true)
    // An outfit layout keeps a label within the same reach.
    expect(arranged(items, 'outfit').find(({ id }) => id === long.id)).toMatchObject({
      x: boardWidth / 2,
      size: widestLabel,
    })
  })
})

describe('the stack', () => {
  test('raising an item puts it on top and keeps the stack numbered from one', () => {
    const items = [piece('a', 5), piece('b', 9), piece('c', 7)]
    expect(raised(items, itemId('a')).map(({ z }) => z)).toEqual([3, 2, 1])
  })

  test('stepping an item swaps it with its neighbour and stops at the ends', () => {
    const items = [piece('a', 1), piece('b', 2), piece('c', 3)]
    expect(stepped(items, itemId('a'), 'forward').map(({ z }) => z)).toEqual([2, 1, 3])
    expect(stepped(items, itemId('c'), 'forward')).toBe(items)
  })

  test('a look made from the table lists its pieces from the top down', () => {
    const items = [piece('a', 1), label('t', 3), piece('b', 2)]
    expect(piecesOnTable(items)).toEqual([pieceId('b'), pieceId('a')])
  })
})

describe('an assistant laying out a table', () => {
  test('a piece lands like one tapped in the editor, and a label lands across the middle', () => {
    const items = laidOut(2)
    const tapped = landed(items, TablePiece.make({ pieceId: pieceId('new') }), itemId('new'))
    expect(tapped).toMatchObject({ _tag: 'PieceItem', pieceId: pieceId('new'), x: 320, y: 860, size: 380, z: 3 })
    const headline = landed(items, TableLabel.make({ text: 'Rain', style: 'headline' }), itemId('rain'))
    expect(headline).toMatchObject({ _tag: 'TextItem', text: 'Rain', x: boardWidth / 2, y: 860 })
  })

  test('an outfit layout puts things in an outfit’s places in stacking order, keeping their sizes', () => {
    const items = [piece('b', 2), piece('a', 1), label('t', 3)]
    const outfit = arranged(items, 'outfit')
    expect(outfit.map(({ id }) => id)).toEqual([itemId('a'), itemId('b'), itemId('t')])
    expect(outfit.map(({ x, y }) => [x, y])).toEqual([
      [290, 320],
      [720, 300],
      [boardWidth / 2, 860],
    ])
    expect(outfit.every(({ size }) => size === 400)).toBe(true)
    expect(arranged(items, 'keep')).toBe(items)
    expect(arranged(items, 'tidy')).toEqual(tidied(items))
  })
})
