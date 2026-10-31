import { type BoardItem, BoardItemId, type Category, type Colour, type Piece, PieceItem } from '@styld/protocol'
import { Array, Option, Order, Schema } from 'effect'

// Today's outfit: plain rules over the person's own pieces, no AI. One piece per slot, each day and each Spin
// a different but repeatable choice, and at most one loud colour on the table.

/** Colours that carry an outfit on their own; everything else goes with anything. Blue is quiet: denim and an
 * Oxford blue shirt go with everything. */
const loud: ReadonlySet<Colour> = new Set(['red', 'pink', 'yellow', 'orange', 'purple', 'green'])

const loudness = (piece: Piece) => (piece.colours.some((colour) => loud.has(colour)) ? 1 : 0)

/** A repeatable shuffle: the same seed puts the same pieces first. */
const hash = (text: string) =>
  Array.makeBy(text.length, (index) => text.charCodeAt(index)).reduce(
    (value, code) => Math.imul(value ^ code, 16_777_619) >>> 0,
    2_166_136_261,
  )
const shuffled = (pieces: ReadonlyArray<Piece>, seed: string): ReadonlyArray<Piece> =>
  Array.sort(
    pieces,
    Order.mapInput(Order.Number, (piece: Piece) => hash(`${seed}:${piece.id}`)),
  )

const ofCategory = (pieces: ReadonlyArray<Piece>, category: Category) =>
  Array.filter(pieces, (piece) => piece.category === category && piece.status === 'ready')

const showsDrawing = (piece: Piece) => piece.picture?.shows === 'clean'

/** A slot's candidates with the clean drawings first, each kind in the seed's order, so Spin keeps photos off the
 * table. Only once there are two drawings to choose between: with one, the slot would never change. */
const drawingsFirst = (candidates: ReadonlyArray<Piece>): ReadonlyArray<Piece> => {
  const drawings = Array.filter(candidates, showsDrawing)
  return drawings.length < 2 ? candidates : [...drawings, ...Array.filter(candidates, (piece) => !showsDrawing(piece))]
}

/** The first piece that keeps the outfit to one loud colour, else the quietest one. */
const pick = (candidates: ReadonlyArray<Piece>, chosen: ReadonlyArray<Piece>): ReadonlyArray<Piece> => {
  const loudSoFar = chosen.reduce((sum, piece) => sum + loudness(piece), 0)
  return Option.match(
    Array.findFirst(candidates, (piece) => loudSoFar + loudness(piece) <= 1),
    { onNone: () => Array.take(candidates, 1), onSome: (piece) => [piece] },
  )
}

/** Where each slot lies on the table: the prototype's four-slot layout, with room for a dress and an
 * accessory. */
type Slot = 'top' | 'outerwear' | 'bottom' | 'dress' | 'shoes' | 'accessory'
const slots: Readonly<Record<Slot, { x: number; y: number; size: number; turn: number }>> = {
  top: { x: 290, y: 320, size: 480, turn: -3 },
  outerwear: { x: 720, y: 300, size: 460, turn: 4 },
  bottom: { x: 320, y: 860, size: 460, turn: 2 },
  dress: { x: 330, y: 590, size: 640, turn: -2 },
  shoes: { x: 735, y: 945, size: 380, turn: -6 },
  accessory: { x: 715, y: 640, size: 280, turn: 5 },
}

export interface Placed {
  readonly slot: Slot
  readonly piece: Piece
}

/** A worn outfit back on the table: each piece in its category's slot. */
export const placedByCategory = (pieces: ReadonlyArray<Piece>): ReadonlyArray<Placed> =>
  pieces.map((piece) => ({ slot: piece.category, piece }))

/** The outfit for a seed (the day and how many times Spin was pressed). */
export const outfitFor = (pieces: ReadonlyArray<Piece>, seed: string): ReadonlyArray<Placed> => {
  const order = (category: Category) => drawingsFirst(shuffled(ofCategory(pieces, category), `${seed}:${category}`))
  const dresses = order('dress')
  const tops = order('top')
  const bottoms = order('bottom')
  const wearsDress = dresses.length > 0 && (hash(seed) % 3 === 0 || tops.length === 0 || bottoms.length === 0)
  const base: ReadonlyArray<Placed> = wearsDress
    ? Array.map(Array.take(dresses, 1), (piece) => ({ slot: 'dress' as const, piece }))
    : [
        ...Array.map(Array.take(bottoms, 1), (piece) => ({ slot: 'bottom' as const, piece })),
        ...Array.map(pick(tops, Array.take(bottoms, 1)), (piece) => ({ slot: 'top' as const, piece })),
      ]
  const chosen = () => base.map(({ piece }) => piece)
  const outerwear = Array.map(pick(order('outerwear'), chosen()), (piece) => ({ slot: 'outerwear' as const, piece }))
  const shoes = Array.map(pick(order('shoes'), [...chosen(), ...outerwear.map(({ piece }) => piece)]), (piece) => ({
    slot: 'shoes' as const,
    piece,
  }))
  const accessory =
    hash(`${seed}:accessory`) % 2 === 0
      ? Array.map(Array.take(order('accessory'), 1), (piece) => ({ slot: 'accessory' as const, piece }))
      : []
  return [...base, ...outerwear, ...shoes, ...accessory]
}

/** A slot a whole outfit still needs. */
export type Missing = 'top' | 'bottom' | 'shoes'

/** What the wardrobe lacks for a whole outfit: a top and a bottom (a dress stands in for both), and shoes. */
export const missingFrom = (pieces: ReadonlyArray<Piece>): ReadonlyArray<Missing> => {
  const has = (category: Category) => ofCategory(pieces, category).length > 0
  const hasDress = has('dress')
  return Array.filter(['top', 'bottom', 'shoes'] as const, (slot) => !has(slot) && (slot === 'shoes' || !hasDress))
}

/** The outfit as a still table: each piece in its slot, keyed by the piece so a Spin brings new ones in. */
export const asItems = (outfit: ReadonlyArray<Placed>): ReadonlyArray<BoardItem> =>
  outfit.map(({ slot, piece }, index) => {
    // A second piece in the same slot lies a little lower and to the right of the first.
    const earlier = outfit.slice(0, index).filter((other) => other.slot === slot).length
    return PieceItem.make({
      id: Schema.decodeUnknownSync(BoardItemId)(`bi_${piece.id.slice(3)}`),
      pieceId: piece.id,
      ...slots[slot],
      x: Math.min(slots[slot].x + earlier * 60, 1000),
      y: Math.min(slots[slot].y + earlier * 60, 1250),
      z: index + 1,
      flipped: false,
    })
  })
