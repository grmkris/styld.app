import { Array, Number, Order, pipe, Schema } from 'effect'

import { type WardrobeKey, wardrobeKeys } from './i18n.ts'

// The paper is 1000 units wide and 1250 tall (4:5). A piece is a square box whose centre is (x, y), whose
// width is `size` units and which is turned by `turn` degrees. The view draws the box 400 units wide and scales
// it by size / 400, so moving, resizing and turning only ever change transforms.

export const PAPER_WIDTH = 1000
export const PAPER_HEIGHT = 1250
export const BASE_SIZE = 400
const MIN_SIZE = 120
const MAX_SIZE = 900

export const Piece = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  size: Schema.Number,
  turn: Schema.Number,
  z: Schema.Number,
})
export type Piece = typeof Piece.Type

export const Pointer = Schema.Struct({ pointerId: Schema.Number, x: Schema.Number, y: Schema.Number })
export type Pointer = typeof Pointer.Type

const normalizeTurn = (degrees: number): number => ((((degrees + 180) % 360) + 360) % 360) - 180

const settle = (piece: Piece): Piece => ({
  ...piece,
  x: Number.clamp(piece.x, { minimum: 0, maximum: PAPER_WIDTH }),
  y: Number.clamp(piece.y, { minimum: 0, maximum: PAPER_HEIGHT }),
  size: Number.clamp(piece.size, { minimum: MIN_SIZE, maximum: MAX_SIZE }),
  turn: normalizeTurn(piece.turn),
})

/** Follow one pointer: the piece moves by exactly the pointer's travel, converted from pixels to units. */
export const dragged = (from: Piece, start: Pointer, now: Pointer, pxPerUnit: number): Piece =>
  settle({ ...from, x: from.x + (now.x - start.x) / pxPerUnit, y: from.y + (now.y - start.y) / pxPerUnit })

const distance = (a: Pointer, b: Pointer): number => Math.hypot(b.x - a.x, b.y - a.y)
const angle = (a: Pointer, b: Pointer): number => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI

/** Two fingers: their spread scales the piece, their angle turns it and their midpoint carries it. */
export const pinched = (
  from: Piece,
  startA: Pointer,
  startB: Pointer,
  a: Pointer,
  b: Pointer,
  pxPerUnit: number,
): Piece => {
  const startSpread = Math.max(distance(startA, startB), 1)
  return settle({
    ...from,
    size: (from.size * distance(a, b)) / startSpread,
    turn: from.turn + angle(a, b) - angle(startA, startB),
    x: from.x + ((a.x + b.x) / 2 - (startA.x + startB.x) / 2) / pxPerUnit,
    y: from.y + ((a.y + b.y) / 2 - (startA.y + startB.y) / 2) / pxPerUnit,
  })
}

/** Where the corner handle sits relative to the piece's centre, in pixels: the box's bottom-right corner, turned. */
export const cornerReach = (piece: Piece, pxPerUnit: number): { x: number; y: number } => {
  const half = (piece.size / 2) * pxPerUnit
  const radians = (piece.turn * Math.PI) / 180
  return {
    x: half * Math.cos(radians) - half * Math.sin(radians),
    y: half * Math.sin(radians) + half * Math.cos(radians),
  }
}

/** Dragging the corner: the reach from the centre to the pointer sets the size and the turn. */
export const turned = (from: Piece, reach: { x: number; y: number }, start: Pointer, now: Pointer): Piece => {
  const nowReach = { x: reach.x + now.x - start.x, y: reach.y + now.y - start.y }
  const startLength = Math.max(Math.hypot(reach.x, reach.y), 1)
  const turnDelta = ((Math.atan2(nowReach.y, nowReach.x) - Math.atan2(reach.y, reach.x)) * 180) / Math.PI
  return settle({ ...from, size: (from.size * Math.hypot(nowReach.x, nowReach.y)) / startLength, turn: from.turn + turnDelta })
}

export const nudged = (from: Piece, change: Partial<Pick<Piece, 'x' | 'y' | 'size' | 'turn'>>): Piece =>
  settle({
    ...from,
    x: from.x + (change.x ?? 0),
    y: from.y + (change.y ?? 0),
    size: from.size + (change.size ?? 0),
    turn: from.turn + (change.turn ?? 0),
  })

const byZ = Order.mapInput(Order.Number, (piece: Piece) => piece.z)

/** Put one piece on top and renumber the rest 1…n, so z never grows without bound. */
export const raised = (pieces: ReadonlyArray<Piece>, id: string): ReadonlyArray<Piece> => {
  const stacked = Array.map(Array.sort(pieces, byZ), (piece) => piece.id)
  const order = Array.appendAll(
    Array.filter(stacked, (other) => other !== id),
    Array.filter(stacked, (other) => other === id),
  )
  return Array.map(pieces, (piece) => ({ ...piece, z: order.indexOf(piece.id) + 1 }))
}

const topZ = (pieces: ReadonlyArray<Piece>): number => Array.reduce(pieces, 0, (top, piece) => Math.max(top, piece.z))

/** A new piece lands near the middle; where exactly follows from how many are already there, not from chance. */
export const placed = (pieces: ReadonlyArray<Piece>, key: WardrobeKey): Piece => {
  const count = pieces.length
  return settle({
    id: key,
    key,
    x: PAPER_WIDTH / 2 + (((count * 137) % 360) - 180),
    y: PAPER_HEIGHT / 2 + (((count * 89) % 400) - 200),
    size: 380,
    turn: ((count * 7) % 13) - 6,
    z: topZ(pieces) + 1,
  })
}

const tilts = [-3, 4, 2, -5, 3, -2] as const

/** Lay the pieces out on an even grid, in the order they are stacked, with a small tilt each. */
export const tidied = (pieces: ReadonlyArray<Piece>): ReadonlyArray<Piece> => {
  const columns = Math.max(1, Math.ceil(Math.sqrt(pieces.length * 0.8)))
  const rows = Math.max(1, Math.ceil(pieces.length / columns))
  const cell = Math.min(PAPER_WIDTH / columns, PAPER_HEIGHT / rows)
  const stacked = Array.map(Array.sort(pieces, byZ), (piece) => piece.id)
  return Array.map(pieces, (piece) => {
    const index = stacked.indexOf(piece.id)
    const column = index % columns
    const row = Math.floor(index / columns)
    return settle({
      ...piece,
      x: (PAPER_WIDTH / columns) * (column + 0.5),
      y: (PAPER_HEIGHT / rows) * (row + 0.5),
      size: cell * 0.92,
      turn: tilts[index % tilts.length] ?? 0,
    })
  })
}

/** Sunday market: the look the prototype's table opens on. */
export const startingPieces: ReadonlyArray<Piece> = [
  { id: 'knit-cable-navy', key: 'knit-cable-navy', x: 290, y: 310, size: 480, turn: -3, z: 2 },
  { id: 'shirt-sky', key: 'shirt-sky', x: 720, y: 290, size: 450, turn: 4, z: 1 },
  { id: 'shorts-denim', key: 'shorts-denim', x: 320, y: 860, size: 450, turn: 2, z: 3 },
  { id: 'derby-black', key: 'derby-black', x: 730, y: 920, size: 380, turn: -6, z: 4 },
]

const STRESS_COUNT = 50

/** Fifty pieces at once, to feel how dragging holds up when the table is crowded. */
export const stressPieces: ReadonlyArray<Piece> = pipe(
  Array.makeBy(STRESS_COUNT, (index) => {
    const key = wardrobeKeys[index % wardrobeKeys.length] ?? 'shirt-sky'
    return {
      id: `stress-${String(index)}`,
      key,
      x: 0,
      y: 0,
      size: 200,
      turn: 0,
      z: index + 1,
    }
  }),
  tidied,
)
