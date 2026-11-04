import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  type Box,
  boardHeight,
  boardWidth,
  clusterLaidOut,
  layoutArrows,
  layoutFor,
  layoutPlans,
  maximumBoardItems,
  OutfitLayout,
  type OutfitPiece,
  outfitsIn,
  outfitsInGrid,
  outfitsLaidOut,
  PieceId,
  type PlacedOutfitPiece,
  slotOf,
} from '../src/index.ts'

const pieceId = (seed: string) => Schema.decodeUnknownSync(PieceId)(`pc_${seed.padEnd(22, 'x')}`)

const anchor: OutfitPiece = { id: pieceId('jeans'), type: 'jeans' }

/** A complete outfit as the engine makes one: a tee under a knit, the jeans, a coat, shoes and three accessories. */
const outfit = (seed: string): ReadonlyArray<OutfitPiece> => [
  { id: pieceId(`${seed}-tee`), type: 'shortSleeveTops' },
  { id: pieceId(`${seed}-knit`), type: 'knitwear' },
  anchor,
  { id: pieceId(`${seed}-coat`), type: 'coats' },
  { id: pieceId(`${seed}-shoes`), type: 'trainers' },
  { id: pieceId(`${seed}-bag`), type: 'bags' },
  { id: pieceId(`${seed}-belt`), type: 'belts' },
  { id: pieceId(`${seed}-hat`), type: 'hats' },
]
const dressed: ReadonlyArray<OutfitPiece> = [
  { id: pieceId('dress'), type: 'dresses' },
  { id: pieceId('sandals'), type: 'sandals' },
  { id: pieceId('clutch'), type: 'bags' },
]
const outfitsFor = (layout: OutfitLayout) =>
  Array.from({ length: outfitsIn(layout) }, (_, index) => outfit(String.fromCharCode(97 + index)))

/** A placed piece's square, as the board draws it. */
const squareOf = ({ x, y, size }: PlacedOutfitPiece): Box => ({
  left: x - size / 2,
  top: y - size / 2,
  width: size,
  height: size,
})
const contains = (outer: Box, inner: Box) =>
  inner.left >= outer.left - 1e-6 &&
  inner.top >= outer.top - 1e-6 &&
  inner.left + inner.width <= outer.left + outer.width + 1e-6 &&
  inner.top + inner.height <= outer.top + outer.height + 1e-6
const overlaps = (a: Box, b: Box) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
/** The smallest box around these pieces' squares. */
const hull = (pieces: ReadonlyArray<PlacedOutfitPiece>): Box => {
  const squares = pieces.map(squareOf)
  const left = Math.min(...squares.map((square) => square.left))
  const top = Math.min(...squares.map((square) => square.top))
  return {
    left,
    top,
    width: Math.max(...squares.map((square) => square.left + square.width)) - left,
    height: Math.max(...squares.map((square) => square.top + square.height)) - top,
  }
}
const sheet: Box = { left: 0, top: 0, width: boardWidth, height: boardHeight }

describe.each(OutfitLayout.literals)('a "One piece, many outfits" board laid out %s', (layout) => {
  const outfits = outfitsFor(layout)
  const placed = outfitsLaidOut(layout, anchor.id, outfits, 1)
  const clusters = outfits.map((_, index) => placed.filter((piece) => piece.outfit === index))
  const [centre] = placed

  test('holds as many outfits as its layout, every piece placed and the table within its limit', () => {
    expect(outfits.length).toBe(layout === 'around' ? 8 : 6)
    expect(placed).toHaveLength(1 + outfits.flat().length)
    expect(placed.length).toBeLessThanOrEqual(maximumBoardItems)
    expect(clusters.every((cluster, index) => cluster.length === outfits[index]?.length)).toBe(true)
  })

  test('every piece lies wholly on the board, within the size limits, and no two share a layer', () => {
    for (const piece of placed) {
      expect(contains(sheet, squareOf(piece))).toBe(true)
      expect(piece.size).toBeGreaterThanOrEqual(40)
    }
    expect(new Set(placed.map(({ z }) => z)).size).toBe(placed.length)
  })

  test('the anchor is large in the centre, the largest piece, alone in its place', () => {
    if (centre === undefined) throw new Error('no anchor in the centre')
    expect(centre).toMatchObject({ outfit: null, pieceId: anchor.id, x: boardWidth / 2, y: boardHeight / 2 })
    const others = placed.slice(1)
    expect(Math.max(...others.map(({ size }) => size))).toBeLessThan(centre.size)
    // Well over its copy in an outfit.
    const copy = clusters[0]?.find(({ pieceId: id }) => id === anchor.id)
    expect(centre.size / (copy?.size ?? Infinity)).toBeGreaterThan(1.5)
    for (const cluster of clusters) expect(overlaps(hull(cluster), squareOf(centre))).toBe(false)
  })

  test('each outfit is one cluster in its own box, accessories included, and no two clusters overlap', () => {
    const boxes = layoutPlans[layout].clusters
    clusters.forEach((cluster, index) => {
      const target = boxes[index]
      if (target === undefined) throw new Error('a cluster without a box')
      for (const piece of cluster) expect(contains(target, squareOf(piece))).toBe(true)
      const accessories = cluster.filter(({ pieceId: id }) => /-(bag|belt|hat)/u.test(id))
      expect(accessories).toHaveLength(3)
    })
    for (const [a, first] of clusters.entries())
      for (const second of clusters.slice(a + 1)) expect(overlaps(hull(first), hull(second))).toBe(false)
  })

  test('each cluster lies together: the coat overlaps the top, the shoes sit below them and the bag touches the rest', () => {
    for (const [index, cluster] of clusters.entries()) {
      const find = (part: string) => {
        const found = cluster.find(({ pieceId: id }) => id === pieceId(`${String.fromCharCode(97 + index)}-${part}`))
        if (found === undefined) throw new Error(`no ${part}`)
        return found
      }
      expect(overlaps(squareOf(find('coat')), squareOf(find('tee')))).toBe(true)
      expect(find('shoes').y).toBeGreaterThan(find('tee').y)
      const rest = cluster.filter(({ pieceId: id }) => id !== find('bag').pieceId)
      expect(rest.some((piece) => overlaps(squareOf(piece), squareOf(find('bag'))))).toBe(true)
    }
  })

  test('the anchor keeps one size and turn in every cluster; neighbours are arranged differently', () => {
    const copies = placed.filter(({ pieceId: id, outfit: place }) => id === anchor.id && place !== null)
    expect(copies).toHaveLength(outfits.length)
    expect(new Set(copies.map(({ size, turn }) => `${String(size)}/${String(turn)}`)).size).toBe(1)
    const offsets = clusters.map((cluster, index) => {
      const target = layoutPlans[layout].clusters[index]
      const bag = cluster.find(({ pieceId: id }) => id.includes('-bag'))
      return Math.round((bag?.x ?? 0) - (target?.left ?? 0))
    })
    expect(offsets[0]).not.toBe(offsets[1])
  })

  test('a lean outfit (a tee, the jeans, trainers) sits in the middle of its box, not to one side', () => {
    const lean = (seed: string): ReadonlyArray<OutfitPiece> => [
      { id: pieceId(`${seed}-tee`), type: 'shortSleeveTops' },
      anchor,
      { id: pieceId(`${seed}-shoes`), type: 'trainers' },
    ]
    const leanOutfits = outfits.map((_, index) => lean(String.fromCharCode(97 + index)))
    const leanPlaced = outfitsLaidOut(layout, anchor.id, leanOutfits, 1)
    layoutPlans[layout].clusters.forEach((target, index) => {
      const around = hull(leanPlaced.filter(({ outfit: place }) => place === index))
      expect(Math.abs(around.left + around.width / 2 - (target.left + target.width / 2))).toBeLessThan(1)
      expect(Math.abs(around.top + around.height / 2 - (target.top + target.height / 2))).toBeLessThan(1)
      expect(contains(target, around)).toBe(true)
    })
  })

  test('another outfit in one place lies exactly where the whole layout would put it', () => {
    const replaced = outfits.map((one, index) => (index === 2 ? dressed : one))
    expect(clusterLaidOut(layout, anchor.id, replaced, 2, 1)).toEqual(
      outfitsLaidOut(layout, anchor.id, replaced, 1).filter(({ outfit: place }) => place === 2),
    )
    const dress = clusterLaidOut(layout, anchor.id, replaced, 2, 1)
    expect(dress.map(({ pieceId: id }) => id).toSorted()).toEqual(dressed.map(({ id }) => id).toSorted())
  })

  test('arrows lead from the anchor to each outfit in its place, and leave with an outfit moved away', () => {
    const ids = outfits.map((one) => one.map(({ id }) => id))
    const arrows = layoutArrows(layout, anchor.id, ids, placed)
    // Eight around has none (fig17); the others one to each outfit.
    const drawn = layoutPlans[layout].arrows ? outfits.length : 0
    expect(arrows).toHaveLength(drawn)
    for (const arrow of arrows) {
      expect(Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1)).toBeGreaterThan(40)
      for (const [x, y] of [
        [arrow.x1, arrow.y1],
        [arrow.x2, arrow.y2],
      ] as const)
        expect(x >= 0 && x <= boardWidth && y >= 0 && y <= boardHeight).toBe(true)
    }
    // The first outfit's shoes dragged to the other side of the table: that outfit's arrow goes.
    const moved = placed.map((piece) =>
      piece.outfit === 0 &&
      slotOf(outfits[0]?.find(({ id }) => id === piece.pieceId)?.type ?? 'shortSleeveTops') === 'shoes'
        ? { ...piece, x: boardWidth - piece.x, y: boardHeight - piece.y }
        : piece,
    )
    expect(layoutArrows(layout, anchor.id, ids, moved)).toHaveLength(Math.max(0, drawn - 1))
    // The anchor moved out of the centre: no arrows at all.
    const off = placed.map((piece) => (piece.outfit === null ? { ...piece, x: 100, y: 100 } : piece))
    expect(layoutArrows(layout, anchor.id, ids, off)).toEqual([])
  })
})

describe('choosing a layout', () => {
  test('a board picks one by its operation, the same on a repeat, and every layout comes up', () => {
    expect(layoutFor('op-1')).toBe(layoutFor('op-1'))
    const picked = new Set(Array.from({ length: 40 }, (_, index) => layoutFor(`op-${String(index)}`)))
    expect(picked).toEqual(new Set(OutfitLayout.literals))
  })

  test('another layout is never the current one, and holds the outfits already kept', () => {
    for (const current of OutfitLayout.literals)
      for (let index = 0; index < 30; index += 1)
        expect(layoutFor(`op-${String(index)}`, { other: current })).not.toBe(current)
    for (let index = 0; index < 30; index += 1)
      expect(layoutFor(`op-${String(index)}`, { other: 'flanking', fewest: 7 })).toBe('around')
  })

  test('fewer outfits than the layout holds fill its first places', () => {
    const two = outfitsLaidOut('around', anchor.id, [outfit('a'), outfit('b')])
    expect(new Set(two.map(({ outfit: place }) => place))).toEqual(new Set([null, 0, 1]))
    expect(outfitsLaidOut('ring', anchor.id, [])).toHaveLength(1)
  })
})

describe.each([1, 3, 4, 6, 8])('%i outfits with no piece at their centre, on a grid', (count) => {
  const outfits = Array.from({ length: count }, (_, index) => outfit(String.fromCharCode(97 + index)))
  const top = 120
  const placed = outfitsInGrid(outfits, top)
  const clusters = outfits.map((_, index) => placed.filter((piece) => piece.outfit === index))

  test('places every piece of every outfit, wholly on the board and below the texts', () => {
    expect(placed).toHaveLength(outfits.flat().length)
    expect(clusters.every((cluster, index) => cluster.length === outfits[index]?.length)).toBe(true)
    for (const piece of placed) {
      expect(contains(sheet, squareOf(piece))).toBe(true)
      expect(piece.y - piece.size / 2).toBeGreaterThanOrEqual(top - 1e-6)
    }
  })

  test('keeps the outfits apart, each in its own part of the board', () => {
    const hulls = clusters.map(hull)
    for (const [index, one] of hulls.entries())
      for (const other of hulls.slice(index + 1)) expect(overlaps(one, other)).toBe(false)
  })
})
