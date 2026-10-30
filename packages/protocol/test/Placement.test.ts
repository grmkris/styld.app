import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  type BoardItem,
  BoardItemId,
  boardHeight,
  boardWidth,
  landing,
  PieceId,
  PieceItem,
  piecesOnTable,
  raised,
  stepped,
  TextItem,
  tidied,
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
      [250, 937.5],
      [250, 312.5],
      [750, 312.5],
    ])
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
