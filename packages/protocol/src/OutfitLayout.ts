// How a "One piece, many outfits" board lays out its table (T-10, Eva's review of 4 November 2026: "it has to lay them
// out together better", "the piece I pick should appear big in the middle"). After her references: the anchor large in
// the centre, and around it each outfit as one tight flat-lay (the outer layer over the top, the bottom beside it,
// shoes at its foot, the bag and accessories tucked against it), the anchor repeated smaller in each. Pure and shared:
// the server places the items, the board's face draws the arrows from the same boxes.
import { Number } from 'effect'
import { boardHeight, boardWidth, maximumItemSize, minimumItemSize, OutfitLayout } from './Board.ts'
import { type PieceType, type Slot, slotOf } from './Garment.ts'
import type { PieceId } from './Wardrobe.ts'

/** A rectangle of the table, in its units. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Where a layout puts the anchor (its centre and size) and its outfits (a box each, read row by row), and whether
 * arrows lead from the anchor to them. */
export interface LayoutPlan {
  readonly anchor: { readonly x: number; readonly y: number; readonly size: number }
  readonly clusters: ReadonlyArray<Box>
  readonly arrows: boolean
}

/** The edge left free around the table, and between neighbouring boxes. */
const margin = 24
const gap = 20

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  width: right - left,
  height: bottom - top,
})

/** Three rows down the table, inside its margin. */
const rows = (() => {
  const height = (boardHeight - 2 * margin - 2 * gap) / 3
  return [0, 1, 2].map((row) => {
    const top = margin + row * (height + gap)
    return [top, top + height] as const
  })
})()
const [topRow = [0, 0], middleRow = [0, 0], bottomRow = [0, 0]] = rows

/** The side columns of the six flanking and the ring: narrow, so the centre column holds the anchor large. */
const sideWidth = 262
const leftSide = [margin, margin + sideWidth] as const
const rightSide = [boardWidth - margin - sideWidth, boardWidth - margin] as const

/** Six flanking (the most common of Eva's references): the anchor in the centre column, three outfits stacked on
 * each side, arrows out to each. */
const flanking: LayoutPlan = {
  anchor: { x: boardWidth / 2, y: boardHeight / 2, size: rightSide[0] - leftSide[1] - 2 * gap },
  clusters: rows.flatMap(([top, bottom]) => [
    box(leftSide[0], top, leftSide[1], bottom),
    box(rightSide[0], top, rightSide[1], bottom),
  ]),
  arrows: true,
}

/** Eight around (fig17): a three-by-three grid, the anchor in the middle cell, no arrows. */
const around: LayoutPlan = (() => {
  const width = (boardWidth - 2 * margin - 2 * gap) / 3
  const columns = [0, 1, 2].map((column) => {
    const left = margin + column * (width + gap)
    return [left, left + width] as const
  })
  const cells = rows.flatMap(([top, bottom]) => columns.map(([left, right]) => box(left, top, right, bottom)))
  return {
    anchor: { x: boardWidth / 2, y: boardHeight / 2, size: Math.min(width, middleRow[1] - middleRow[0]) },
    clusters: cells.filter((_, cell) => cell !== 4),
    arrows: false,
  }
})()

/** Six radial (fig15): two outfits above, one at each side, two below, arrows out from the anchor between them. */
const ring: LayoutPlan = (() => {
  const inset = 70
  const pair = ([top, bottom]: readonly [number, number]) => [
    box(margin + inset, top, boardWidth / 2 - gap / 2, bottom),
    box(boardWidth / 2 + gap / 2, top, boardWidth - margin - inset, bottom),
  ]
  return {
    anchor: {
      x: boardWidth / 2,
      y: boardHeight / 2,
      size: Math.min(rightSide[0] - leftSide[1] - 2 * gap, middleRow[1] - middleRow[0]),
    },
    clusters: [
      ...pair(topRow),
      box(leftSide[0], middleRow[0], leftSide[1], middleRow[1]),
      box(rightSide[0], middleRow[0], rightSide[1], middleRow[1]),
      ...pair(bottomRow),
    ],
    arrows: true,
  }
})()

/** Each layout's plan; how many outfits a board holds follows its layout. */
export const layoutPlans: Readonly<Record<OutfitLayout, LayoutPlan>> = { flanking, around, ring }

/** How many outfits a board in this layout holds. */
export const outfitsIn = (layout: OutfitLayout): number => layoutPlans[layout].clusters.length

/** A piece of an outfit on a template board: what the layout needs to place it. */
export interface OutfitPiece {
  readonly id: PieceId
  readonly type: PieceType
}

/** Where a piece lies on a template board, and which outfit it belongs to by its place in the list; the large anchor in
 * the centre belongs to none. */
export interface PlacedOutfitPiece {
  readonly outfit: number | null
  readonly pieceId: PieceId
  readonly x: number
  readonly y: number
  readonly size: number
  readonly turn: number
  readonly z: number
  readonly flipped: false
}

/** One outfit's flat-lay in a portrait sheet of its own, 1000 by 1250: the bottom on the right, full height, the top
 * beside it at the waist, the outer layer over the top's left, shoes at the foot, a one-piece or a set across the
 * middle. `order` stacks them: the bottom lowest, then the top, the layer over it, shoes and accessories on top. */
const sheetWidth = 1000
const sheetHeight = 1250
const clusterSpots: Readonly<
  Record<Slot, { readonly x: number; readonly y: number; readonly size: number; readonly turn: number; order: number }>
> = {
  bottom: { x: 700, y: 640, size: 600, turn: 2, order: 0 },
  onePiece: { x: 540, y: 560, size: 760, turn: -2, order: 1 },
  set: { x: 540, y: 560, size: 760, turn: -2, order: 1 },
  top: { x: 430, y: 400, size: 470, turn: -3, order: 2 },
  layer: { x: 280, y: 420, size: 540, turn: 3, order: 3 },
  shoes: { x: 280, y: 1020, size: 360, turn: -6, order: 4 },
  accessory: { x: 560, y: 900, size: 280, turn: 5, order: 5 },
}

/** Where a cluster's accessories go, in three arrangements taken in turn, so neighbouring outfits are not laid out
 * alike (F-33): each tucked against the outfit (between the top and the bottom, at the layer's side, by the shoes). */
const accessoryArrangements: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [
    [560, 880, 290],
    [150, 700, 220],
    [820, 1090, 220],
  ],
  [
    [200, 760, 290],
    [570, 1080, 220],
    [860, 180, 200],
  ],
  [
    [600, 960, 290],
    [840, 160, 200],
    [140, 820, 220],
  ],
]

/** A square of `size` around (x, y), moved and shrunk as little as needed to lie within the box. */
const within = (target: Box, x: number, y: number, size: number) => {
  const fitted = Math.min(size, target.width, target.height)
  const half = fitted / 2
  return {
    x: Number.clamp(x, { minimum: target.left + half, maximum: target.left + target.width - half }),
    y: Number.clamp(y, { minimum: target.top + half, maximum: target.top + target.height - half }),
    size: fitted,
  }
}

/** The stacking left below the outfits for the anchor, and the room each cluster takes in the stack. */
const anchorZ = 1
const clusterZ = 20

/** One outfit laid flat in its box at the layout's scale, every piece within the box. Every other one (by `shift`) is
 * mirrored and its accessories take another arrangement; the anchor keeps one size and turn in every cluster, so it
 * reads as the same piece in each. */
const clusterOf = (
  anchorId: PieceId | null,
  outfit: ReadonlyArray<OutfitPiece>,
  index: number,
  target: Box,
  scale: number,
  shift: number,
): ReadonlyArray<PlacedOutfitPiece> => {
  const mirrored = (index + shift) % 2 === 1
  const arrangement = accessoryArrangements[(index + shift) % accessoryArrangements.length] ?? []
  // The sheet drawn at the scale, centred in the box.
  const left = target.left + (target.width - sheetWidth * scale) / 2
  const top = target.top + (target.height - sheetHeight * scale) / 2
  const stacked = outfit
    .map((piece, at) => ({ piece, at }))
    .toSorted((a, b) => clusterSpots[slotOf(a.piece.type)].order - clusterSpots[slotOf(b.piece.type)].order)
  return stacked.map(({ piece, at }, layer): PlacedOutfitPiece => {
    const slot = slotOf(piece.type)
    const spot = clusterSpots[slot]
    const earlier = outfit.slice(0, at).filter((other) => slotOf(other.type) === slot).length
    const [x, y, size] =
      slot === 'accessory'
        ? (arrangement[earlier] ?? [spot.x, spot.y, spot.size])
        : [spot.x + earlier * 90, spot.y + earlier * 60, spot.size]
    const isAnchor = piece.id === anchorId
    const placed = within(target, left + (mirrored ? sheetWidth - x : x) * scale, top + y * scale, size * scale)
    return {
      outfit: index,
      pieceId: piece.id,
      ...placed,
      size: Number.clamp(placed.size, { minimum: minimumItemSize, maximum: maximumItemSize }),
      turn: isAnchor || !mirrored ? spot.turn : -spot.turn,
      z: anchorZ + 1 + index * clusterZ + layer,
      flipped: false,
    }
  })
}

/** The table of a "One piece, many outfits" board in a layout: the anchor large in the centre, then each outfit, in
 * the layout's boxes row by row, as a flat-lay of its own. All clusters share one scale, the one that fits the
 * smallest box. A layout holds `outfitsIn(layout)` outfits; any more are left off the table. */
export const outfitsLaidOut = (
  layout: OutfitLayout,
  anchorId: PieceId,
  outfits: ReadonlyArray<ReadonlyArray<OutfitPiece>>,
  shift = 0,
): ReadonlyArray<PlacedOutfitPiece> => {
  const plan = layoutPlans[layout]
  const scale = Math.min(
    ...plan.clusters.map((cluster) => Math.min(cluster.width / sheetWidth, cluster.height / sheetHeight)),
  )
  return [
    { outfit: null, pieceId: anchorId, ...plan.anchor, turn: 0, z: anchorZ, flipped: false },
    ...outfits.flatMap((outfit, index) => {
      const target = plan.clusters[index]
      return target === undefined ? [] : clusterOf(anchorId, outfit, index, target, scale, shift)
    }),
  ]
}

/** The boxes of `count` outfits on a grid below `top`: two columns up to six, three beyond, row by row, a last row
 * that is not full centred. */
const gridBoxes = (count: number, top: number): ReadonlyArray<Box> => {
  const columns = count <= 1 ? 1 : count <= 6 ? 2 : 3
  const rowCount = Math.ceil(count / columns)
  const width = (boardWidth - 2 * margin - (columns - 1) * gap) / columns
  const height = (boardHeight - margin - Math.max(top, margin) - (rowCount - 1) * gap) / rowCount
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns)
    const inRow = Math.min(columns, count - row * columns)
    const left = margin + ((columns - inRow) * (width + gap)) / 2 + (index % columns) * (width + gap)
    const boxTop = Math.max(top, margin) + row * (height + gap)
    return box(left, boxTop, left + width, boxTop + height)
  })
}

/** The table of outfits with no piece at their centre (the house boards of outfits, owner 4 November 2026): each
 * outfit a flat-lay of its own, as the template board's clusters are, in a grid of boxes below `top` (labels go above
 * it), all at the one scale that fits the smallest box. */
export const outfitsInGrid = (
  outfits: ReadonlyArray<ReadonlyArray<OutfitPiece>>,
  top = 0,
): ReadonlyArray<PlacedOutfitPiece> => {
  const boxes = gridBoxes(outfits.length, top)
  const scale = Math.min(...boxes.map((cluster) => Math.min(cluster.width / sheetWidth, cluster.height / sheetHeight)))
  return outfits.flatMap((outfit, index) => {
    const target = boxes[index]
    return target === undefined ? [] : clusterOf(null, outfit, index, target, scale, 0)
  })
}

/** Only one of a cluster's places: the outfit at `index` laid out as it would be among the others. */
export const clusterLaidOut = (
  layout: OutfitLayout,
  anchorId: PieceId,
  outfits: ReadonlyArray<ReadonlyArray<OutfitPiece>>,
  index: number,
  shift = 0,
): ReadonlyArray<PlacedOutfitPiece> =>
  outfitsLaidOut(layout, anchorId, outfits, shift).filter(({ outfit }) => outfit === index)

/** A thin arrow from the anchor out to an outfit, in the table's units: its line from (x1, y1) to its head at
 * (x2, y2). */
export interface Arrow {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

const isInside = (target: Box, x: number, y: number) =>
  x >= target.left && x <= target.left + target.width && y >= target.top && y <= target.top + target.height

/** How far from the anchor's centre an arrow starts, as a part of its size, and how far short of a box it stops. */
const arrowStart = 0.34
const arrowClearance = 18

/** Where the line from (x, y) to the box's centre enters the box. */
const entry = (target: Box, x: number, y: number) => {
  const cx = target.left + target.width / 2
  const cy = target.top + target.height / 2
  const dx = cx - x
  const dy = cy - y
  const reach = Math.min(
    dx === 0 ? Infinity : Math.abs(target.width / 2 / dx),
    dy === 0 ? Infinity : Math.abs(target.height / 2 / dy),
  )
  return { x: cx - dx * reach, y: cy - dy * reach, length: Math.hypot(dx, dy) * (1 - reach) }
}

/** A table item as the arrows read it: a piece and where its centre lies. */
interface TableSpot {
  readonly pieceId?: string
  readonly x: number
  readonly y: number
}

/** The arrows of a board in this layout, drawn by its face, not stored: one from the anchor to each outfit while the
 * anchor is still in the centre and every piece of that outfit still lies in its box. Moving an outfit away takes its
 * arrow with it. */
export const layoutArrows = (
  layout: OutfitLayout,
  anchorId: PieceId,
  outfits: ReadonlyArray<ReadonlyArray<string>>,
  items: ReadonlyArray<TableSpot>,
): ReadonlyArray<Arrow> => {
  const plan = layoutPlans[layout]
  const { x, y, size } = plan.anchor
  const centre = box(x - size / 2, y - size / 2, x + size / 2, y + size / 2)
  const anchored = items.some((item) => item.pieceId === anchorId && isInside(centre, item.x, item.y))
  if (!plan.arrows || !anchored) return []
  return outfits.flatMap((pieceIds, index) => {
    const target = plan.clusters[index]
    if (target === undefined) return []
    const inPlace = pieceIds.every((pieceId) =>
      items.some((item) => item.pieceId === pieceId && isInside(target, item.x, item.y)),
    )
    if (!inPlace || pieceIds.length === 0) return []
    const end = entry(target, x, y)
    const toward = Math.hypot(end.x - x, end.y - y)
    const start = Math.min(size * arrowStart, toward - arrowClearance * 2)
    const stop = toward - arrowClearance
    const ux = (end.x - x) / toward
    const uy = (end.y - y) / toward
    return [{ x1: x + ux * start, y1: y + uy * start, x2: x + ux * stop, y2: y + uy * stop }]
  })
}

/** A layout for a new board or another one: by the operation's id (random, so a board picks one by chance, and the
 * same again on a repeat), among those other than the current one and holding at least `fewest` outfits. */
export const layoutFor = (
  operationId: string,
  options: { readonly other?: OutfitLayout; readonly fewest?: number } = {},
): OutfitLayout => {
  const choices = OutfitLayout.literals.filter(
    (layout) => layout !== options.other && outfitsIn(layout) >= (options.fewest ?? 0),
  )
  const seed = Array.from(operationId).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7)
  return choices[seed % Math.max(1, choices.length)] ?? 'flanking'
}
