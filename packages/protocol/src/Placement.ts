// Where things lie on a board's table, shared by the editor, the server and the assistants, so a board an
// assistant arranges looks like one a person tidied.
import { Array, Match, Number, Order, Schema } from 'effect'
import {
  type BoardItem,
  type BoardItemId,
  boardHeight,
  boardWidth,
  ImageItem,
  maximumItemSize,
  minimumItemSize,
  PieceItem,
  type TableLayout,
  type TableThing,
  TextItem,
} from './Board.ts'
import type { PieceId } from './Wardrobe.ts'

const normalizeTurn = (degrees: number): number => ((((degrees + 180) % 360) + 360) % 360) - 180

/** Keep an item on the sheet, within its size limits, with its turn in (-180, 180]. */
export const settle = <Item extends BoardItem>(item: Item): Item => ({
  ...item,
  x: Number.clamp(item.x, { minimum: 0, maximum: boardWidth }),
  y: Number.clamp(item.y, { minimum: 0, maximum: boardHeight }),
  size: Number.clamp(item.size, { minimum: minimumItemSize, maximum: maximumItemSize }),
  turn: normalizeTurn(item.turn),
})

const byZ = Order.mapInput(Order.Number, (item: BoardItem) => item.z)

/** The ids from the bottom of the stack to the top. */
const stackOrder = (items: ReadonlyArray<BoardItem>): ReadonlyArray<string> =>
  Array.map(Array.sort(items, byZ), (item) => item.id)

/** Renumber the stack 1…n in the given order, so z never grows without bound. */
const restacked = (items: ReadonlyArray<BoardItem>, order: ReadonlyArray<string>): ReadonlyArray<BoardItem> =>
  Array.map(items, (item) => ({ ...item, z: order.indexOf(item.id) + 1 }))

/** Put one item on top of the others. */
export const raised = (items: ReadonlyArray<BoardItem>, id: string): ReadonlyArray<BoardItem> => {
  const order = stackOrder(items)
  return restacked(
    items,
    Array.appendAll(
      Array.filter(order, (other) => other !== id),
      Array.filter(order, (other) => other === id),
    ),
  )
}

/** Move one item a step up or down the stack. */
export const stepped = (
  items: ReadonlyArray<BoardItem>,
  id: string,
  direction: 'forward' | 'backward',
): ReadonlyArray<BoardItem> => {
  const order = [...stackOrder(items)]
  const at = order.indexOf(id)
  const to = direction === 'forward' ? at + 1 : at - 1
  if (at < 0 || to < 0 || to >= order.length) return items
  const swapped = order.map((other, index) => (index === at ? (order[to] ?? other) : index === to ? id : other))
  return restacked(items, swapped)
}

export const topZ = (items: ReadonlyArray<BoardItem>): number =>
  Array.reduce(items, 0, (top, item) => Math.max(top, item.z))

/** Where new items land, in turn: an outfit's places on the table first (top, layer, bottom, shoes, an
 * accessory), then the gaps between them. A full round shifts the next one down and right. */
const spots: ReadonlyArray<readonly [number, number]> = [
  [290, 320],
  [720, 300],
  [320, 860],
  [735, 945],
  [715, 620],
  [300, 590],
  [520, 450],
  [520, 1060],
]

/** Where a new item lands: the next free-looking spot, by how many are already there, never by chance. */
export const landing = (items: ReadonlyArray<BoardItem>, size: number) => {
  const count = items.length
  const [x, y] = spots[count % spots.length] ?? [boardWidth / 2, boardHeight / 2]
  const round = Math.floor(count / spots.length) * 40
  return {
    x: Math.min(x + round, boardWidth),
    y: Math.min(y + round, boardHeight),
    size,
    turn: ((count * 7) % 13) - 6,
    z: topZ(items) + 1,
    flipped: false,
  }
}

const tilts = [-3, 4, 2, -5, 3, -2] as const

/** Lay the items out on an even grid, in stacking order, each with a small tilt. */
export const tidied = (items: ReadonlyArray<BoardItem>): ReadonlyArray<BoardItem> => {
  const columns = Math.max(1, Math.ceil(Math.sqrt(items.length * 0.8)))
  const rows = Math.max(1, Math.ceil(items.length / columns))
  const cell = Math.min(boardWidth / columns, boardHeight / rows)
  const order = stackOrder(items)
  return Array.map(items, (item) => {
    const index = order.indexOf(item.id)
    return settle({
      ...item,
      x: (boardWidth / columns) * ((index % columns) + 0.5),
      y: (boardHeight / rows) * (Math.floor(index / columns) + 0.5),
      size: cell * 0.92,
      turn: tilts[index % tilts.length] ?? 0,
    })
  })
}

const isPieceItem = Schema.is(PieceItem)

/** The pieces on the table, from the top of the stack down: a look made from a board. */
export const piecesOnTable = (items: ReadonlyArray<BoardItem>): ReadonlyArray<PieceId> =>
  Array.flatMap(Array.reverse(Array.sort(items, byZ)), (item) => (isPieceItem(item) ? [item.pieceId] : []))

/** A thing put on the table where the next one lands, as the editor puts it: a piece, a larger picture, or a label
 * across the middle. */
export const landed = (items: ReadonlyArray<BoardItem>, thing: TableThing, id: BoardItemId): BoardItem =>
  Match.value(thing).pipe(
    Match.tagsExhaustive({
      TablePiece: ({ pieceId }) => PieceItem.make({ id, pieceId, ...landing(items, 380) }),
      TablePicture: ({ imageId }) => ImageItem.make({ id, imageId, ...landing(items, 420) }),
      TableLabel: ({ text, style }) => TextItem.make({ id, text, style, ...landing(items, 360), x: boardWidth / 2 }),
    }),
  )

/** Lay every item out again in an outfit's places, in stacking order, each keeping its size. */
const nothingPlaced: ReadonlyArray<BoardItem> = []

const outfitted = (items: ReadonlyArray<BoardItem>): ReadonlyArray<BoardItem> =>
  Array.reduce(Array.sort(items, byZ), nothingPlaced, (placed, item) => {
    const spot = landing(placed, item.size)
    return [...placed, settle({ ...item, ...spot, x: Schema.is(TextItem)(item) ? boardWidth / 2 : spot.x })]
  })

/** The table laid out as asked: as it is, on an even grid, or in an outfit's places. */
export const arranged = (items: ReadonlyArray<BoardItem>, layout: TableLayout): ReadonlyArray<BoardItem> =>
  Match.value(layout).pipe(
    Match.when('keep', () => items),
    Match.when('tidy', () => tidied(items)),
    Match.when('outfit', () => outfitted(items)),
    Match.exhaustive,
  )
