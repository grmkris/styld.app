import {
  type BoardItem,
  boardHeight,
  boardWidth,
  maximumItemSize,
  minimumItemSize,
  type PieceId,
  PieceItem,
} from '@styld/protocol'
import { Array, Number, Order, Schema } from 'effect'

/** A finger, the mouse or a pen, where it is now, in page pixels. */
export const Pointer = Schema.Struct({ pointerId: Schema.Number, x: Schema.Number, y: Schema.Number })
export type Pointer = typeof Pointer.Type

/** The parts of an item that moving, pinching and turning change. */
export type Placement = Pick<BoardItem, 'x' | 'y' | 'size' | 'turn'>

/** Items are drawn at this many units wide and scaled by size / base, so only transforms change. */
export const baseSize = 400

const normalizeTurn = (degrees: number): number => ((((degrees + 180) % 360) + 360) % 360) - 180

/** Keep an item on the sheet, within its size limits, with its turn in (-180, 180]. */
export const settle = <Item extends BoardItem>(item: Item): Item => ({
  ...item,
  x: Number.clamp(item.x, { minimum: 0, maximum: boardWidth }),
  y: Number.clamp(item.y, { minimum: 0, maximum: boardHeight }),
  size: Number.clamp(item.size, { minimum: minimumItemSize, maximum: maximumItemSize }),
  turn: normalizeTurn(item.turn),
})

/** One pointer: the item moves exactly as far as the pointer travels, converted from pixels to units. */
export const dragged = <Item extends BoardItem>(from: Item, start: Pointer, now: Pointer, pxPerUnit: number): Item =>
  settle({ ...from, x: from.x + (now.x - start.x) / pxPerUnit, y: from.y + (now.y - start.y) / pxPerUnit })

const distance = (a: Pointer, b: Pointer): number => Math.hypot(b.x - a.x, b.y - a.y)
const angle = (a: Pointer, b: Pointer): number => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI

/** Two fingers: their spread scales the item, their angle turns it and their midpoint carries it. */
export const pinched = <Item extends BoardItem>(
  from: Item,
  start: readonly [Pointer, Pointer],
  now: readonly [Pointer, Pointer],
  pxPerUnit: number,
): Item => {
  const [startA, startB] = start
  const [a, b] = now
  return settle({
    ...from,
    size: (from.size * distance(a, b)) / Math.max(distance(startA, startB), 1),
    turn: from.turn + angle(a, b) - angle(startA, startB),
    x: from.x + ((a.x + b.x) / 2 - (startA.x + startB.x) / 2) / pxPerUnit,
    y: from.y + ((a.y + b.y) / 2 - (startA.y + startB.y) / 2) / pxPerUnit,
  })
}

/** Dragging the corner: the reach from the centre to the pointer sets the size and the turn. */
export const turned = <Item extends BoardItem>(
  from: Item,
  reach: { readonly x: number; readonly y: number },
  start: Pointer,
  now: Pointer,
): Item => {
  const nowReach = { x: reach.x + now.x - start.x, y: reach.y + now.y - start.y }
  const turnDelta = ((Math.atan2(nowReach.y, nowReach.x) - Math.atan2(reach.y, reach.x)) * 180) / Math.PI
  return settle({
    ...from,
    size: (from.size * Math.hypot(nowReach.x, nowReach.y)) / Math.max(Math.hypot(reach.x, reach.y), 1),
    turn: from.turn + turnDelta,
  })
}

/** A keyboard step: move, resize or turn by a fixed amount. */
export const nudged = <Item extends BoardItem>(from: Item, change: Partial<Placement>): Item =>
  settle({
    ...from,
    x: from.x + (change.x ?? 0),
    y: from.y + (change.y ?? 0),
    size: from.size + (change.size ?? 0),
    turn: from.turn + (change.turn ?? 0),
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

/** The pieces on the table, from the top of the stack down: a look made from a board. */
export const piecesOnTable = (items: ReadonlyArray<BoardItem>): ReadonlyArray<PieceId> =>
  Array.flatMap(Array.reverse(Array.sort(items, byZ)), (item) => (isPieceItem(item) ? [item.pieceId] : []))

const isPieceItem = Schema.is(PieceItem)
