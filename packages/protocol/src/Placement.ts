// Where things lie on a board's table, shared by the editor, the server and the assistants, so a board an
// assistant arranges looks like one a person tidied.
import { Array, Match, Number, Order, Schema } from 'effect'
import {
  type BoardItem,
  BoardItemId,
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
import { type PieceType, type Slot, slotOf } from './Garment.ts'
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

const isTextItem = Schema.is(TextItem)

/** The largest a label is drawn while it stays on the sheet: its frame fits its words up to 90% of the table's
 * width at this size (the editor draws items 400 units wide and scales them by size / 400), so a label this size or
 * smaller, centred across the table, never runs off an edge. */
export const widestLabel = 400

/** A label's line across the top of a tidied table, and the most of the table the labels take. */
const labelLine = 120
const labelsReach = boardHeight / 3

/** Lay the items out in stacking order: labels centred across the top, a line each and never larger than
 * `widestLabel`, so their words stay on the sheet (a label put in a grid cell near an edge ran off it, browser review
 * 2 November 2026); everything else on an even grid below them, each with a small tilt. */
export const tidied = (items: ReadonlyArray<BoardItem>): ReadonlyArray<BoardItem> => {
  const stacked = Array.sort(items, byZ)
  const labels = stacked.filter(isTextItem)
  const things = stacked.filter((item) => !isTextItem(item))
  const line = labels.length === 0 ? 0 : Math.min(labelLine, labelsReach / labels.length)
  const top = labels.length * line
  const columns = Math.max(1, Math.ceil(Math.sqrt(things.length * 0.8)))
  const rows = Math.max(1, Math.ceil(things.length / columns))
  const height = boardHeight - top
  const cell = Math.min(boardWidth / columns, height / rows)
  const placed = new Map<string, BoardItem>([
    ...labels.map((label, index): readonly [string, BoardItem] => [
      label.id,
      settle({
        ...label,
        x: boardWidth / 2,
        y: line * (index + 0.5),
        size: Math.min(label.size, widestLabel),
        turn: 0,
      }),
    ]),
    ...things.map((item, index): readonly [string, BoardItem] => [
      item.id,
      settle({
        ...item,
        x: (boardWidth / columns) * ((index % columns) + 0.5),
        y: top + (height / rows) * (Math.floor(index / columns) + 0.5),
        size: cell * 0.92,
        turn: tilts[index % tilts.length] ?? 0,
      }),
    ]),
  ])
  return Array.map(items, (item) => placed.get(item.id) ?? item)
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
    if (!isTextItem(item)) return [...placed, settle({ ...item, ...spot })]
    return [...placed, settle({ ...item, ...spot, x: boardWidth / 2, size: Math.min(item.size, widestLabel) })]
  })

/** The table laid out as asked: as it is, on an even grid, or in an outfit's places. */
export const arranged = (items: ReadonlyArray<BoardItem>, layout: TableLayout): ReadonlyArray<BoardItem> =>
  Match.value(layout).pipe(
    Match.when('keep', () => items),
    Match.when('tidy', () => tidied(items)),
    Match.when('outfit', () => outfitted(items)),
    Match.exhaustive,
  )

/** Where each place of an outfit lies on a flat-lay: tops and layers above, bottoms and shoes below, a one-piece or a
 * set across the middle, an accessory to the side. */
const flatLaySpots: Readonly<Record<Slot, { x: number; y: number; size: number; turn: number }>> = {
  top: { x: 290, y: 320, size: 480, turn: -3 },
  layer: { x: 720, y: 300, size: 460, turn: 4 },
  bottom: { x: 320, y: 860, size: 460, turn: 2 },
  onePiece: { x: 330, y: 590, size: 640, turn: -2 },
  set: { x: 330, y: 590, size: 640, turn: -2 },
  shoes: { x: 735, y: 945, size: 380, turn: -6 },
  accessory: { x: 715, y: 640, size: 280, turn: 5 },
}

/** An outfit laid flat on the table, in the order given: each piece in its place, a second piece in the same place a
 * little lower and to the right. Each item is keyed by its piece, so a new outfit brings new pieces in. */
export const flatLay = (
  pieces: ReadonlyArray<{ readonly id: PieceId; readonly type: PieceType }>,
): ReadonlyArray<BoardItem> =>
  pieces.map((piece, index) => {
    const slot = slotOf(piece.type)
    const spot = flatLaySpots[slot]
    const earlier = pieces.slice(0, index).filter((other) => slotOf(other.type) === slot).length
    return PieceItem.make({
      id: Schema.decodeUnknownSync(BoardItemId)(`bi_${piece.id.slice(3)}`),
      pieceId: piece.id,
      ...spot,
      x: Math.min(spot.x + earlier * 60, boardWidth),
      y: Math.min(spot.y + earlier * 60, boardHeight),
      z: index + 1,
      flipped: false,
    })
  })
