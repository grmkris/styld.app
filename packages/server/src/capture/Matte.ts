import { onBorder } from '@styld/imaging'
import { type Box, type Mask, type Rgba, upright } from './Pixels.ts'

/** A size in pixels. */
interface Size {
  readonly width: number
  readonly height: number
}

/** How a cut-out's edge is refined.
 * - `band`: how far, in picture pixels, the edge may move from SAM's. Pixels further inside stay the garment's
 *   and pixels further out stay transparent, so a refined edge never reaches a neighbour or a hand.
 * - `radius`, `epsilon`: the guided filter's window and smoothing (grey levels 0 to 1); a small window follows
 *   the photo's own edges rather than the fabric's texture.
 * - `sharpness`: how steeply opacity rises across the refined edge; 1 keeps the filter's soft ramp, higher
 *   values leave an edge about a pixel wide. */
export interface EdgeSettings {
  readonly band: number
  readonly radius: number
  readonly epsilon: number
  readonly sharpness: number
}

const edgeSettings: EdgeSettings = { band: 3, radius: 4, epsilon: 0.0025, sharpness: 3 }

/** Parts of a garment smaller than this share of its largest part are specks, and holes smaller than this
 * share of the garment are pinholes; a hole a hand left is far larger and stays. */
const speckShare = 0.01
const pinholeShare = 0.002

/** Each position's window sum along `line`, `r` either side: past the ends the line repeats its end values
 * (`clamp`) or reads as nothing. */
const windowSums = (line: Float32Array | Uint8Array, r: number, clamp: boolean) => {
  const length = line.length
  const last = length - 1
  const sums = new Float32Array(length)
  let sum = 0
  for (let index = -r; index <= r; index++)
    sum += clamp ? (line[Math.min(last, Math.max(0, index))] ?? 0) : (line[index] ?? 0)
  for (let index = 0; index < length; index++) {
    sums[index] = sum
    const entering = index + r + 1
    const leaving = index - r
    sum += clamp
      ? (line[Math.min(last, entering)] ?? 0) - (line[Math.max(0, leaving)] ?? 0)
      : (line[entering] ?? 0) - (line[leaving] ?? 0)
  }
  return sums
}

/** A column of a row-major grid, copied into `into`. */
const columnOf = (values: Float32Array | Uint8Array, width: number, x: number, into: Float32Array) => {
  for (let y = 0; y < into.length; y++) into[y] = values[y * width + x] ?? 0
  return into
}

/** A box filter: the mean of each pixel's (2r+1)² window, clamped at the edges, in two running-sum passes. */
const boxMean = (values: Float32Array, width: number, height: number, r: number) => {
  const across = new Float32Array(values.length)
  for (let y = 0; y < height; y++)
    across.set(windowSums(values.subarray(y * width, (y + 1) * width), r, true), y * width)
  const mean = new Float32Array(values.length)
  const window = (2 * r + 1) * (2 * r + 1)
  const scratch = new Float32Array(height)
  for (let x = 0; x < width; x++) {
    const sums = windowSums(columnOf(across, width, x, scratch), r, true)
    for (let y = 0; y < height; y++) mean[y * width + x] = (sums[y] ?? 0) / window
  }
  return mean
}

/** The mask spread smoothly over `region` of the picture: each pixel samples the mask under its centre
 * between its four nearest mask pixels, so a mask SAM sent smaller than the picture gets round edges. */
const spread = (mask: Mask, from: Size, picture: Size, region: Box) => {
  const scaleX = picture.width / from.width
  const scaleY = picture.height / from.height
  const maskWidth = mask.bounds.right - mask.bounds.left
  const maskHeight = mask.bounds.bottom - mask.bounds.top
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= maskWidth || y >= maskHeight ? 0 : (mask.raster[y * maskWidth + x] ?? 0) === 0 ? 0 : 1
  const width = region.right - region.left
  const soft = new Float32Array(width * (region.bottom - region.top))
  for (let row = 0; row < region.bottom - region.top; row++) {
    const sy = (region.top + row + 0.5) / scaleY - 0.5 - mask.bounds.top
    const y0 = Math.floor(sy)
    const fy = sy - y0
    for (let column = 0; column < width; column++) {
      const sx = (region.left + column + 0.5) / scaleX - 0.5 - mask.bounds.left
      const x0 = Math.floor(sx)
      const fx = sx - x0
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
      const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
      soft[row * width + column] = top * (1 - fy) + bottom * fy
    }
  }
  return soft
}

/** The picture's grey levels over `region`, 0 to 1. */
const greyOf = (picture: Rgba, region: Box) => {
  const width = region.right - region.left
  const grey = new Float32Array(width * (region.bottom - region.top))
  for (let row = 0; row < region.bottom - region.top; row++)
    for (let column = 0; column < width; column++) {
      const at = ((region.top + row) * picture.width + region.left + column) * 4
      grey[row * width + column] =
        (0.299 * (picture.data[at] ?? 0) + 0.587 * (picture.data[at + 1] ?? 0) + 0.114 * (picture.data[at + 2] ?? 0)) /
        255
    }
  return grey
}

/** He, Sun and Tang's guided filter: `input` smoothed so its edges follow the edges of `guide`. */
const guidedFilter = (
  guide: Float32Array,
  input: Float32Array,
  width: number,
  height: number,
  settings: EdgeSettings,
) => {
  const { radius, epsilon } = settings
  const meanGuide = boxMean(guide, width, height, radius)
  const meanInput = boxMean(input, width, height, radius)
  const squares = boxMean(
    guide.map((value) => value * value),
    width,
    height,
    radius,
  )
  const products = boxMean(
    guide.map((value, at) => value * (input[at] ?? 0)),
    width,
    height,
    radius,
  )
  const slope = new Float32Array(guide.length)
  const offset = new Float32Array(guide.length)
  for (let at = 0; at < guide.length; at++) {
    const mean = meanGuide[at] ?? 0
    const variance = (squares[at] ?? 0) - mean * mean
    slope[at] = ((products[at] ?? 0) - mean * (meanInput[at] ?? 0)) / (variance + epsilon)
    offset[at] = (meanInput[at] ?? 0) - (slope[at] ?? 0) * mean
  }
  const meanSlope = boxMean(slope, width, height, radius)
  const meanOffset = boxMean(offset, width, height, radius)
  return guide.map((value, at) => (meanSlope[at] ?? 0) * value + (meanOffset[at] ?? 0))
}

/** Whether each pixel has a chosen pixel within `r` in both directions: a one-byte dilation in two running
 * passes. */
const dilate = (chosen: Uint8Array, width: number, height: number, r: number) => {
  const across = new Uint8Array(chosen.length)
  for (let y = 0; y < height; y++) {
    const sums = windowSums(chosen.subarray(y * width, (y + 1) * width), r, false)
    for (let x = 0; x < width; x++) across[y * width + x] = (sums[x] ?? 0) > 0 ? 1 : 0
  }
  const near = new Uint8Array(chosen.length)
  const scratch = new Float32Array(height)
  for (let x = 0; x < width; x++) {
    const sums = windowSums(columnOf(across, width, x, scratch), r, false)
    for (let y = 0; y < height; y++) near[y * width + x] = (sums[y] ?? 0) > 0 ? 1 : 0
  }
  return near
}

/** Opacity from SAM's spread mask and the guided filter: sure inside and sure outside keep SAM's answer, and
 * only the band around SAM's edge takes the filter's, so the edge can move at most `band` pixels. */
const opacity = (soft: Float32Array, refined: Float32Array, width: number, height: number, settings: EdgeSettings) => {
  const { band, sharpness } = settings
  const inside = soft.map((value) => (value >= 0.5 ? 1 : 0))
  const nearInside = dilate(new Uint8Array(inside), width, height, band)
  const nearOutside = dilate(new Uint8Array(inside.map((value) => 1 - value)), width, height, band)
  return Uint8Array.from(soft, (_value, at) => {
    if ((nearOutside[at] ?? 0) === 0) return 255
    if ((nearInside[at] ?? 0) === 0) return 0
    return Math.round(255 * Math.min(1, Math.max(0, ((refined[at] ?? 0) - 0.5) * sharpness + 0.5)))
  })
}

/** A pixel's four neighbours inside a `width` × `height` region; -1 past an edge. */
const neighbours = (at: number, width: number, height: number) => {
  const x = at % width
  const y = Math.floor(at / width)
  return [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, y > 0 ? at - width : -1, y < height - 1 ? at + width : -1]
}

/** Number the part of `chosen` pixels around `start` as `part`: its size, and whether it touches the border. */
const fillPart = (
  start: number,
  part: number,
  label: Int32Array,
  chosen: (at: number) => boolean,
  width: number,
  height: number,
) => {
  let size = 0
  let touches = false
  const stack = [start]
  label[start] = part
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    size++
    touches = touches || onBorder(at, width, height)
    for (const next of neighbours(at, width, height))
      if (next >= 0 && label[next] === -1 && chosen(next)) {
        label[next] = part
        stack.push(next)
      }
  }
  return { size, touches }
}

/** The connected parts of `chosen` pixels (four neighbours), as a part number per pixel and each part's size
 * and whether it touches the region's border. */
const partsOf = (chosen: (at: number) => boolean, width: number, height: number) => {
  const label = new Int32Array(width * height).fill(-1)
  const sizes: Array<number> = []
  const border: Array<boolean> = []
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== -1 || !chosen(start)) continue
    const { size, touches } = fillPart(start, sizes.length, label, chosen, width, height)
    sizes.push(size)
    border.push(touches)
  }
  return { label, sizes, border }
}

/** Drop specks apart from the garment, with the soft edge around them, and fill the garment's pinholes. */
const tidy = (alpha: Uint8Array, width: number, height: number, band: number) => {
  const solid = partsOf((at) => (alpha[at] ?? 0) >= 128, width, height)
  const largest = Math.max(0, ...solid.sizes)
  const garment = solid.sizes.reduce((sum, size) => sum + size, 0)
  const kept = Uint8Array.from(alpha, (_value, at) => {
    const part = solid.label[at] ?? -1
    return part >= 0 && (solid.sizes[part] ?? 0) >= speckShare * largest ? 1 : 0
  })
  const nearKept = dilate(kept, width, height, band)
  const holes = partsOf((at) => (alpha[at] ?? 0) < 128, width, height)
  return alpha.map((value, at) => {
    if ((nearKept[at] ?? 0) === 0) return 0
    const hole = holes.label[at] ?? -1
    const pinhole = hole >= 0 && !(holes.border[hole] ?? true) && (holes.sizes[hole] ?? 0) < pinholeShare * garment
    return pinhole ? 255 : value
  })
}

/** Rows are refined in strips with a margin of rows around each, wide enough for every window that reaches
 * the strip, so a large garment never holds more than a strip's working arrays at once. */
const stripRows = 192

/** The rows `[top, bottom)` of a region, with the rows `[from, to)` a strip works on to fill them. */
const strips = (height: number, margin: number) =>
  Array.from({ length: Math.ceil(height / stripRows) }, (_strip, index) => {
    const top = index * stripRows
    const bottom = Math.min(height, top + stripRows)
    return { top, bottom, from: Math.max(0, top - margin), to: Math.min(height, bottom + margin) }
  })

/** The rows `[from, to)` of a region, as a box in the picture. */
const rowsOf = (region: Box, from: number, to: number): Box => ({
  ...region,
  top: region.top + from,
  bottom: region.top + to,
})

/** The garment's colours carried into its soft edge, for one strip: a pixel that is only partly the garment
 * takes the mean colour of the fully opaque garment pixels near it, so the background does not tint the edge. */
const edgeColours = (
  picture: Rgba,
  region: Box,
  alpha: Uint8Array,
  strip: ReturnType<typeof strips>[number],
  band: number,
  data: Uint8Array,
) => {
  const width = region.right - region.left
  const rows = strip.to - strip.from
  const offset = strip.from * width
  const sourceAt = (at: number, channel: number) =>
    ((region.top + strip.from + Math.floor(at / width)) * picture.width + region.left + (at % width)) * 4 + channel
  const opaque = Float32Array.from({ length: rows * width }, (_value, at) =>
    (alpha[offset + at] ?? 0) === 255 ? 1 : 0,
  )
  const near = boxMean(opaque, width, rows, band + 1)
  const channels = [0, 1, 2].map((channel) =>
    boxMean(
      opaque.map((weight, at) => weight * (picture.data[sourceAt(at, channel)] ?? 0)),
      width,
      rows,
      band + 1,
    ),
  )
  for (let at = (strip.top - strip.from) * width; at < (strip.bottom - strip.from) * width; at++) {
    const value = alpha[offset + at] ?? 0
    const edge = value > 0 && value < 255 && (near[at] ?? 0) > 0
    for (let channel = 0; channel < 3; channel++)
      data[(offset + at) * 4 + channel] = edge
        ? Math.round((channels[channel]?.[at] ?? 0) / (near[at] ?? 1))
        : (picture.data[sourceAt(at, channel)] ?? 0)
    data[(offset + at) * 4 + 3] = value
  }
}

/** A garment cut from `picture` with refined edges, from SAM's `mask` in `from` coordinates (SAM's frame, or
 * the picture itself): spread smoothly onto the picture, its edge snapped to the photo's own edges within a
 * few pixels, specks and pinholes tidied, and its edge colours taken from the garment. Returns the cut-out
 * cropped to what is opaque, where that is in the picture, and its area in opaque pixels. */
export const refinedCutOut = (picture: Rgba, mask: Mask, from: Size, settings: EdgeSettings = edgeSettings) => {
  const { band, radius } = settings
  const { mask: source, size } = upright(mask, from, picture)
  const reach = band + 2 * radius + 2
  const scaleX = picture.width / size.width
  const scaleY = picture.height / size.height
  const region: Box = {
    left: Math.max(0, Math.floor(source.bounds.left * scaleX) - reach),
    top: Math.max(0, Math.floor(source.bounds.top * scaleY) - reach),
    right: Math.min(picture.width, Math.ceil(source.bounds.right * scaleX) + reach),
    bottom: Math.min(picture.height, Math.ceil(source.bounds.bottom * scaleY) + reach),
  }
  const width = region.right - region.left
  const height = region.bottom - region.top
  const raw = new Uint8Array(width * height)
  for (const strip of strips(height, reach)) {
    const rows = rowsOf(region, strip.from, strip.to)
    const soft = spread(source, size, picture, rows)
    const refined = guidedFilter(greyOf(picture, rows), soft, width, strip.to - strip.from, settings)
    const alpha = opacity(soft, refined, width, strip.to - strip.from, settings)
    raw.set(alpha.subarray((strip.top - strip.from) * width, (strip.bottom - strip.from) * width), strip.top * width)
  }
  const alpha = tidy(raw, width, height, band)
  const data = new Uint8Array(width * height * 4)
  for (const strip of strips(height, band + 2)) edgeColours(picture, region, alpha, strip, band, data)
  return {
    ...tighten({ width, height, data }, region),
    area: alpha.reduce((sum, value) => sum + (value >= 128 ? 1 : 0), 0),
  }
}

/** The cut-out cropped to its opaque pixels, and where that crop sits in the picture. */
const tighten = (piece: Rgba, region: Box): { readonly piece: Rgba; readonly bounds: Box } => {
  let left = piece.width
  let top = piece.height
  let right = 0
  let bottom = 0
  for (let y = 0; y < piece.height; y++)
    for (let x = 0; x < piece.width; x++)
      if ((piece.data[(y * piece.width + x) * 4 + 3] ?? 0) > 0) {
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x + 1)
        bottom = Math.max(bottom, y + 1)
      }
  if (right <= left || bottom <= top) return { piece: { width: 0, height: 0, data: new Uint8Array() }, bounds: region }
  const width = right - left
  const data = new Uint8Array(width * (bottom - top) * 4)
  for (let y = top; y < bottom; y++)
    data.set(piece.data.subarray((y * piece.width + left) * 4, (y * piece.width + right) * 4), (y - top) * width * 4)
  const bounds = {
    left: region.left + left,
    top: region.top + top,
    right: region.left + right,
    bottom: region.top + bottom,
  }
  return { piece: { width, height: bottom - top, data }, bounds }
}
