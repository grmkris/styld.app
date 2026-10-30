import { type BoardItem, settle } from '@styld/protocol'
import { Schema } from 'effect'

/** A finger, the mouse or a pen, where it is now, in page pixels. */
export const Pointer = Schema.Struct({ pointerId: Schema.Number, x: Schema.Number, y: Schema.Number })
export type Pointer = typeof Pointer.Type

/** The parts of an item that moving, pinching and turning change. */
export type Placement = Pick<BoardItem, 'x' | 'y' | 'size' | 'turn'>

/** Items are drawn at this many units wide and scaled by size / base, so only transforms change. */
export const baseSize = 400

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
