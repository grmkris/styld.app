import { opaqueBounds, type Rgba } from './Raster.ts'
import { sampled } from './Turn.ts'

// A turn's frame sheet, ported from the interactive-garment-starter's `prepare_frames` (MIT, Amir Mušić) and the
// 30 October spike's `process.py`: 30 frames from the start of the turn to where it stops, ending on the clean front,
// keyed, the hook cut above the hanger's arms, scaled once about a fixed pivot into a grid of cells.

/** A sheet's layout: `frames` cells of `width` by `height` in `columns`, the hanger's apex at `pivot` (fractions of a
 * cell). */
export interface SheetLayout {
  readonly frames: number
  readonly columns: number
  readonly width: number
  readonly height: number
  readonly pivot: readonly [number, number]
}

export const sheetLayout: SheetLayout = { frames: 30, columns: 6, width: 288, height: 384, pivot: [0.5, 0.027] }

/** How many opaque pixels each row of `picture` holds. */
const rowWidths = (picture: Rgba) =>
  Array.from({ length: picture.height }, (_, row) => {
    let count = 0
    for (let column = 0; column < picture.width; column++)
      if ((picture.data[(row * picture.width + column) * 4 + 3] ?? 0) > 128) count++
    return count
  })

/** The first row where the hanger's arms begin: the hook's stem above it is at most a sliver of the frame's width. */
export const armsRow = (picture: Rgba) => {
  const sliver = picture.width * 0.042
  const row = rowWidths(picture).findIndex((count) => count > sliver)
  return Math.max(0, row)
}

/** `picture` with everything above `row` made transparent: the hook cut away. */
export const clipAbove = (picture: Rgba, row: number): Rgba => {
  const data = new Uint8Array(picture.data)
  for (let at = 3; at < Math.max(0, row - 1) * picture.width * 4; at += 4) data[at] = 0
  return { width: picture.width, height: picture.height, data }
}

/** How wide a frame's silhouette is: the columns with any opaque pixel. */
export const silhouetteWidth = (picture: Rgba) => {
  let columns = 0
  for (let column = 0; column < picture.width; column++)
    for (let row = 0; row < picture.height; row++)
      if ((picture.data[(row * picture.width + column) * 4 + 3] ?? 0) > 128) {
        columns++
        break
      }
  return columns
}

/** The frame where the turn stops: the silhouette widens from the side view to the front, then levels off while the
 * cloth keeps swaying, so the first frame within 97% of its final width (measured on Veo 3.1 Lite takes). */
export const turnEnd = (widths: ReadonlyArray<number>) => {
  const last = widths.slice(-12).toSorted((a, b) => a - b)
  const final = last[Math.floor(last.length / 2)] ?? 0
  const end = widths.findIndex((width) => width >= 0.97 * final)
  return Math.max(1, end)
}

/** Which of the first `end` + 1 frames make a sheet of `count`, evenly spread from the first to the end. */
export const pickedFrames = (end: number, count: number) =>
  Array.from({ length: count }, (_, index) => Math.round((index * end) / (count - 1)))

/** One frame drawn into a cell: sampled about `pivot` so the pivot lands on the cell's own, at one `scale`. */
const drawCell = (
  frame: Rgba,
  sheet: Rgba,
  cell: { readonly left: number; readonly top: number },
  place: Placement,
) => {
  const { layout, pivot, scale } = place
  const target = [layout.width * layout.pivot[0], layout.height * layout.pivot[1]] as const
  for (let row = 0; row < layout.height; row++)
    for (let column = 0; column < layout.width; column++) {
      const x = pivot[0] + (column + 0.5 - target[0]) / scale - 0.5
      const y = pivot[1] + (row + 0.5 - target[1]) / scale - 0.5
      if (x < -1 || y < -1 || x > frame.width || y > frame.height) continue
      const at = ((cell.top + row) * sheet.width + cell.left + column) * 4
      for (let channel = 0; channel < 4; channel++) sheet.data[at + channel] = Math.round(sampled(frame, x, y, channel))
    }
}

interface Placement {
  readonly layout: SheetLayout
  readonly pivot: readonly [number, number]
  readonly scale: number
}

/** Where the frames sit in their cells: the middle of the top of everything they show stays fixed (the hanger's
 * apex), scaled once so every frame fits with room at the sides and bottom. None when a frame shows nothing. */
const placement = (frames: ReadonlyArray<Rgba>, layout: SheetLayout): Placement | undefined => {
  const boxes = frames.map((frame) => opaqueBounds(frame, 20))
  if (boxes.some((box) => box === undefined)) return undefined
  const known = boxes.filter((box) => box !== undefined)
  const left = Math.min(...known.map((box) => box.left))
  const right = Math.max(...known.map((box) => box.right))
  const top = Math.min(...known.map((box) => box.top))
  const bottom = Math.max(...known.map((box) => box.bottom))
  const pivot = [(left + right) / 2, top] as const
  const reach = Math.max(1, pivot[0] - left, right - pivot[0])
  const scale = Math.min(
    (layout.width / 2 - 16) / reach,
    (layout.height - layout.height * layout.pivot[1] - 18) / Math.max(1, bottom - top),
  )
  return { layout, pivot, scale }
}

/** The frames packed into one sheet, row by row, or none when a frame shows nothing (a key that removed it all). */
export const packSheet = (frames: ReadonlyArray<Rgba>, layout: SheetLayout = sheetLayout): Rgba | undefined => {
  const place = placement(frames, layout)
  if (place === undefined) return undefined
  const rows = Math.ceil(layout.frames / layout.columns)
  const sheet: Rgba = {
    width: layout.columns * layout.width,
    height: rows * layout.height,
    data: new Uint8Array(layout.columns * layout.width * rows * layout.height * 4),
  }
  frames
    .slice(0, layout.frames)
    .forEach((frame, index) =>
      drawCell(
        frame,
        sheet,
        { left: (index % layout.columns) * layout.width, top: Math.floor(index / layout.columns) * layout.height },
        place,
      ),
    )
  return sheet
}
