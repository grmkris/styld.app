import {
  boardHeight,
  boardWidth,
  maximumItemSize,
  minimumItemSize,
  type PieceType,
  type PlacedThing,
  type SeedLabel,
  slotOf,
  TableLabel,
  TablePiece,
} from '@styld/protocol'
import type { Garment } from './Tables.ts'

// How a house board's table looks (owner, 4 November 2026, after Eva's Pinterest references): the board's name as a
// headline across the top and its line under it; each outfit one dense stack (the layer over the top, the bottom
// standing beside them, the shoes at the hem, the bag and small things at the sides) filling its cell of a grid of up
// to three across; a packing list or a collage in rows (tops and layers, then bottoms, then shoes, bags and small
// things) with every piece at its true size beside the others. Pure: the same board always lies the same way.

/** A garment's width over its height, as its cut-out stands: measured on the house garments' cut-outs. */
const aspects: Partial<Record<PieceType, number>> = {
  shortSleeveTops: 1.08,
  longSleeveTops: 1.2,
  sleevelessTops: 0.75,
  shirts: 1.1,
  knitwear: 1.25,
  hoodies: 1.2,
  bodysuits: 0.7,
  jackets: 0.9,
  coats: 0.56,
  blazers: 0.85,
  gilets: 0.8,
  trousers: 0.48,
  jeans: 0.42,
  shorts: 0.95,
  skirts: 0.83,
  dresses: 0.5,
  jumpsuits: 0.45,
  trainers: 2.56,
  loafers: 2.6,
  boots: 2,
  sandals: 2.8,
  flats: 2.6,
  heels: 2.4,
  sportShoes: 2.5,
  outdoorShoes: 2.3,
  bags: 0.72,
  scarves: 1.2,
  hats: 1.4,
  eyewear: 2.6,
  belts: 2.5,
  gloves: 1,
  socks: 0.9,
  hairAccessories: 1.5,
}
const aspectOf = (type: PieceType) => aspects[type] ?? 1

/** How tall a garment stands on the table, in centimetres, so pieces keep their sizes to each other; shoes, bags and
 * small things are drawn larger than life, as the references draw them, or they vanish beside a coat. */
const heights: Partial<Record<PieceType, number>> = {
  coats: 105,
  dresses: 110,
  jumpsuits: 140,
  trousers: 102,
  jeans: 102,
  skirts: 68,
  shorts: 45,
  jackets: 70,
  blazers: 72,
  gilets: 66,
  shirts: 74,
  knitwear: 62,
  hoodies: 66,
  shortSleeveTops: 66,
  longSleeveTops: 64,
  sleevelessTops: 60,
  bodysuits: 66,
  bags: 42,
  scarves: 52,
  hats: 26,
  eyewear: 11,
  belts: 16,
  gloves: 30,
  socks: 32,
  hairAccessories: 14,
  jewellery: 18,
}
const shoeHeight = 24
const heightOf = (type: PieceType) => {
  const slot = slotOf(type)
  return heights[type] ?? (slot === 'shoes' ? shoeHeight : slot === 'accessory' ? 14 : 66)
}

/** A frame's side as the table allows it. */
const sizeWithin = (size: number) => Math.min(maximumItemSize, Math.max(minimumItemSize, size))

/** A piece's square frame kept on the sheet: a wide shoe's frame reaches past the shoe, and is moved in with it. */
const onSheet = (placed: PlacedThing): PlacedThing => {
  const half = placed.size / 2
  const within = (at: number, extent: number) => Math.min(extent - half, Math.max(half, at))
  return { ...placed, x: within(placed.x, boardWidth), y: within(placed.y, boardHeight) }
}

interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}
type Align = 'start' | 'centre' | 'end'

/** A piece placed as large as fits a box: its square frame's centre and side, the cut-out contained in the frame. */
const fitted = (garment: Garment, box: Box, alignX: Align, alignY: Align): PlacedThing => {
  const aspect = aspectOf(garment.type)
  const room = { w: box.x1 - box.x0, h: box.y1 - box.y0 }
  const w = Math.min(room.w, room.h * aspect)
  const h = w / aspect
  const at = (start: number, end: number, extent: number, align: Align) =>
    align === 'start' ? start + extent / 2 : align === 'end' ? end - extent / 2 : (start + end) / 2
  return onSheet({
    thing: TablePiece.make({ pieceId: garment.id }),
    x: at(box.x0, box.x1, w, alignX),
    y: at(box.y0, box.y1, h, alignY),
    size: sizeWithin(Math.max(w, h)),
    turn: 0,
  })
}

/** A part of a cell, in fractions of its width and height. */
const part = (cell: Box, x0: number, y0: number, x1: number, y1: number): Box => {
  const w = cell.x1 - cell.x0
  const h = cell.y1 - cell.y0
  return { x0: cell.x0 + x0 * w, y0: cell.y0 + y0 * h, x1: cell.x0 + x1 * w, y1: cell.y0 + y1 * h }
}

/** Where the small things of a stack go, in turn: top right, low right, then low left above the shoes. */
const smallSpots = [
  [0.7, 0, 1, 0.18],
  [0.74, 0.86, 1, 1],
  [0.02, 0.5, 0.36, 0.68],
  [0.5, 0.86, 0.74, 1],
  [0.7, 0.18, 1, 0.34],
  [0.02, 0.38, 0.3, 0.5],
] as const

/** One outfit as a dense stack in its cell: the bottom (or a dress) stands on the right, the top on the left above
 * it and the layer over the top, the shoes at the hem, the bag beside the bottom, small things at the edges. Listed
 * from the back of the pile to the front. */
const stacked = (outfit: ReadonlyArray<Garment>, cell: Box): ReadonlyArray<PlacedThing> => {
  const of = (slots: ReadonlyArray<string>) => outfit.filter((garment) => slots.includes(slotOf(garment.type)))
  const [whole, ...moreWholes] = of(['onePiece', 'set'])
  const [bottom, ...moreBottoms] = of(['bottom'])
  const [top, ...moreTops] = of(['top'])
  const [layer, ...moreLayers] = of(['layer'])
  const [shoes, ...moreShoes] = of(['shoes'])
  const accessories = of(['accessory'])
  const bag = accessories.find(({ type }) => type === 'bags')
  const small = [
    ...moreWholes,
    ...(whole === undefined ? [] : bottom === undefined ? [] : [bottom]),
    ...moreBottoms,
    ...moreTops,
    ...moreLayers,
    ...moreShoes,
    ...accessories.filter((garment) => garment !== bag),
  ]
  const standing = whole ?? bottom
  const back: Array<PlacedThing> = []
  if (standing !== undefined)
    back.push(fitted(standing, part(cell, 0.4, whole === undefined ? 0.18 : 0.04, 1, 0.9), 'centre', 'start'))
  if (top !== undefined)
    back.push(
      fitted(
        top,
        part(cell, layer === undefined ? 0.02 : 0.28, 0.02, layer === undefined ? 0.64 : 0.78, 0.42),
        'centre',
        'start',
      ),
    )
  if (layer !== undefined) back.push(fitted(layer, part(cell, 0, 0.02, 0.6, 0.5), 'centre', 'start'))
  if (bag !== undefined) back.push(fitted(bag, part(cell, 0.02, 0.46, 0.42, 0.74), 'centre', 'centre'))
  if (shoes !== undefined) back.push(fitted(shoes, part(cell, 0, 0.74, 0.56, 0.99), 'start', 'end'))
  // Past the spots, the rest stand smaller along the bottom: every piece of the outfit is on the table.
  small.forEach((garment, index) => {
    const [x0, y0, x1, y1] = smallSpots[index % smallSpots.length] ?? smallSpots[0]
    const shrink = index < smallSpots.length ? 1 : 0.7
    back.push(fitted(garment, part(cell, x0, y0, x0 + (x1 - x0) * shrink, y0 + (y1 - y0) * shrink), 'centre', 'centre'))
  })
  return back
}

/** A headline's and a line's words as the table sets them: a headline's line holds about 14 characters and a label's
 * about 22, whatever their size, and a line is 1.14 times its font. */
const linesOf = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine))
const headlineFont = 120
const labelFont = 70
/** A label's size for a font: the table sets a label's font as 12 (headline) or 7 (label) hundredths of its width at
 * size 400. */
const sizeFor = (font: number, base: number) => (400 * font) / base
const fontOf = (style: SeedLabel['style']) => (style === 'headline' ? headlineFont : labelFont)

/** The board's headline and its lines across the top, never off the sheet: the labels placed, each its own (the
 * Slovenian translates them one by one), and where the rest of the table starts. */
const heading = (labels: ReadonlyArray<Pick<SeedLabel, 'text' | 'style'>>) => {
  const placed: Array<PlacedThing> = []
  const label = (text: string, style: SeedLabel['style'], y: number, size: number) =>
    placed.push({ thing: TableLabel.make({ text, style }), x: boardWidth / 2, y, size, turn: 0 })
  let y = 34
  labels.forEach((line, index) => {
    // The first is the headline; the lines under it are smaller.
    const lines = linesOf(line.text, line.style === 'headline' ? 14 : 22)
    const font = index > 0 ? 30 : lines === 1 ? 72 : lines === 2 ? 62 : 50
    const height = lines * font * (line.style === 'headline' ? 1 : 1.15)
    label(line.text, line.style, y + height / 2, sizeFor(font, fontOf(line.style)))
    y += height + (index === 0 ? 18 : 8)
  })
  return { placed, top: y + 14 }
}

const margin = 28

/** How many outfits a row holds: one, two side by side, two by two, then three across. */
const columnsFor = (count: number) => (count <= 2 ? count : count === 4 ? 2 : 3)

/** Outfits, each a stack in its cell, under the board's headline and lines; a last row with fewer stacks is centred. */
export const outfitBoard = (
  outfits: ReadonlyArray<ReadonlyArray<Garment>>,
  labels: ReadonlyArray<Pick<SeedLabel, 'text' | 'style'>>,
): ReadonlyArray<PlacedThing> => {
  const columns = Math.max(1, columnsFor(outfits.length))
  const rows = Math.max(1, Math.ceil(outfits.length / columns))
  const { placed, top } = heading(labels)
  const w = (boardWidth - 2 * margin) / columns
  const h = (boardHeight - margin - top) / rows
  // A stack is about three quarters as wide as it is tall: a wide cell keeps it so, centred.
  const width = Math.min(w, h * 0.78)
  const cellOf = (index: number): Box => {
    const row = Math.floor(index / columns)
    const inRow = Math.min(columns, outfits.length - row * columns)
    const x0 = margin + ((columns - inRow) * w) / 2 + (index % columns) * w
    const y0 = top + row * h
    return { x0: x0 + (w - width) / 2 + 8, y0: y0 + 6, x1: x0 + (w + width) / 2 - 8, y1: y0 + h - 6 }
  }
  return [...outfits.flatMap((outfit, index) => stacked(outfit, cellOf(index))), ...placed]
}

/** A row of more than five, as two. */
const split = (row: ReadonlyArray<Garment>): ReadonlyArray<ReadonlyArray<Garment>> => {
  if (row.length <= 5) return row.length === 0 ? [] : [row]
  const half = Math.ceil(row.length / 2)
  return [row.slice(0, half), row.slice(half)]
}

/** The rows of a packing list or a collage: tops and layers, then bottoms and dresses, then shoes, bags and small
 * things; a row of more than five is split. */
const rowsOf = (garments: ReadonlyArray<Garment>) => {
  const group = (slots: ReadonlyArray<string>) => garments.filter((garment) => slots.includes(slotOf(garment.type)))
  return [
    ...split(group(['layer', 'top'])),
    ...split(group(['bottom', 'onePiece', 'set'])),
    ...split(group(['shoes', 'accessory'])),
  ]
}

/** A packing list or a collage: its pieces in rows at their true sizes to each other, as large as the table allows,
 * under the board's headline and line. */
export const capsuleBoard = (
  garments: ReadonlyArray<Garment>,
  labels: ReadonlyArray<Pick<SeedLabel, 'text' | 'style'>>,
): ReadonlyArray<PlacedThing> => {
  const { placed, top } = heading(labels)
  const rows = rowsOf(garments)
  const gap = 22
  const width = boardWidth - 2 * margin
  const room = boardHeight - margin - top - gap * Math.max(0, rows.length - 1)
  const tallest = rows.map((row) => Math.max(...row.map(({ type }) => heightOf(type))))
  const widthOf = (row: ReadonlyArray<Garment>) =>
    row.reduce((sum, { type }) => sum + heightOf(type) * aspectOf(type), 0) + gap * (row.length - 1)
  // One scale for the whole table, so a coat stays a coat's length beside a jumper.
  const scale = Math.min(
    room / tallest.reduce((sum, height) => sum + height, 0),
    ...rows.map((row) => (width - gap * (row.length - 1)) / (widthOf(row) - gap * (row.length - 1))),
  )
  const used = tallest.reduce((sum, height) => sum + height * scale, 0) + gap * Math.max(0, rows.length - 1)
  let y = top + (boardHeight - margin - top - used) / 2
  const pieces = rows.flatMap((row, index) => {
    const rowHeight = (tallest[index] ?? 0) * scale
    const sizes = row.map(({ type }) => ({ w: heightOf(type) * aspectOf(type) * scale, h: heightOf(type) * scale }))
    const spread = (width - sizes.reduce((sum, { w }) => sum + w, 0)) / (row.length + 1)
    let x = margin + spread
    const things = row.map((garment, at) => {
      const { w, h } = sizes[at] ?? { w: 0, h: 0 }
      const thing: PlacedThing = onSheet({
        thing: TablePiece.make({ pieceId: garment.id }),
        x: x + w / 2,
        // Short things sit on the row's line, as on a shelf.
        y: y + rowHeight - h / 2,
        size: sizeWithin(Math.max(w, h)),
        turn: 0,
      })
      x += w + spread
      return thing
    })
    y += rowHeight + gap
    return things
  })
  return [...pieces, ...placed]
}
