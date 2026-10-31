import { convertIndexedToRgb, decode, encode } from 'fast-png'

/** A picture in memory: four bytes a pixel (red, green, blue, alpha), rows top to bottom. The Worker and the
 * browser's canvases share this shape. */
export interface Rgba {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

const sample8 = (value: number, depth: number) => (depth === 16 ? value >> 8 : value)

/** Where a pixel's alpha sits for a PNG's channel count, if it has one. */
const alphaOffset = (channels: number) => (channels === 2 ? 1 : channels === 4 ? 3 : -1)

const toRgba = (width: number, height: number, source: ArrayLike<number>, channels: number, depth: number): Rgba => {
  const data = new Uint8Array(width * height * 4)
  const sample = (at: number) => sample8(source[at] ?? 0, depth)
  const grey = channels <= 2
  const alpha = alphaOffset(channels)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = pixel * channels
    const red = sample(at)
    data[pixel * 4] = red
    data[pixel * 4 + 1] = grey ? red : sample(at + 1)
    data[pixel * 4 + 2] = grey ? red : sample(at + 2)
    data[pixel * 4 + 3] = alpha < 0 ? 255 : sample(at + alpha)
  }
  return { width, height, data }
}

/** Whether pixel `at` of a `width` × `height` picture lies on its outer edge. */
export const onBorder = (at: number, width: number, height: number) => {
  const x = at % width
  const y = Math.floor(at / width)
  return x === 0 || y === 0 || x === width - 1 || y === height - 1
}

/** Decode a PNG into RGBA, whatever its colour type and depth. */
export const decodePng = (bytes: Uint8Array): Rgba => {
  const png = decode(bytes)
  if (png.palette !== undefined) {
    const rgb = convertIndexedToRgb(png)
    return toRgba(png.width, png.height, rgb, png.palette[0]?.length ?? 3, 8)
  }
  return toRgba(png.width, png.height, png.data, png.channels, png.depth)
}

/** Encode RGBA as a PNG with transparency. */
export const encodePng = (picture: Rgba): Uint8Array =>
  encode({ width: picture.width, height: picture.height, data: picture.data, channels: 4, depth: 8 })

/** The average of `picture`'s pixels in the rectangle from (left, top) up to (right, bottom), into `out` at `to`. */
const average = (picture: Rgba, box: readonly [number, number, number, number], out: Uint8Array, to: number) => {
  const [left, top, right, bottom] = box
  const sums = [0, 0, 0, 0]
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const from = (y * picture.width + x) * 4
      for (let channel = 0; channel < 4; channel++)
        sums[channel] = (sums[channel] ?? 0) + (picture.data[from + channel] ?? 0)
    }
  const count = (bottom - top) * (right - left)
  for (let channel = 0; channel < 4; channel++) out[to + channel] = Math.round((sums[channel] ?? 0) / count)
}

/** `picture` scaled down to fit within `longest` on its long edge, averaging the pixels each one covers; a picture
 * already that small is returned as it is. */
export const shrink = (picture: Rgba, longest: number): Rgba => {
  const scale = Math.min(1, longest / Math.max(picture.width, picture.height))
  if (scale === 1) return picture
  const width = Math.max(1, Math.round(picture.width * scale))
  const height = Math.max(1, Math.round(picture.height * scale))
  const data = new Uint8Array(width * height * 4)
  const span = (index: number, size: number) => {
    const start = Math.floor(index / scale)
    return [start, Math.max(start + 1, Math.min(size, Math.floor((index + 1) / scale)))] as const
  }
  for (let y = 0; y < height; y++) {
    const [top, bottom] = span(y, picture.height)
    for (let x = 0; x < width; x++) {
      const [left, right] = span(x, picture.width)
      average(picture, [left, top, right, bottom], data, (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

/** `picture` laid on a flat grey ground, opaque: how a cut-out is shown to a model that reads no transparency. */
export const flatten = (picture: Rgba, ground = 236): Rgba => {
  const data = new Uint8Array(picture.data.length)
  for (let at = 0; at < picture.data.length; at += 4) {
    const alpha = (picture.data[at + 3] ?? 0) / 255
    for (let channel = 0; channel < 3; channel++)
      data[at + channel] = Math.round((picture.data[at + channel] ?? 0) * alpha + ground * (1 - alpha))
    data[at + 3] = 255
  }
  return { width: picture.width, height: picture.height, data }
}

/** A rectangle in pixels: `left`/`top` inclusive, `right`/`bottom` exclusive. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** The pixels of `box`, clamped to the picture. */
export const crop = (picture: Rgba, box: Box): Rgba => {
  const left = Math.max(0, Math.min(picture.width, box.left))
  const top = Math.max(0, Math.min(picture.height, box.top))
  const width = Math.max(0, Math.min(picture.width, box.right) - left)
  const height = Math.max(0, Math.min(picture.height, box.bottom) - top)
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const from = ((top + row) * picture.width + left) * 4
    data.set(picture.data.subarray(from, from + width * 4), row * width * 4)
  }
  return { width, height, data }
}

/** The smallest box holding every pixel more opaque than `threshold`, or none for a blank picture. */
export const opaqueBounds = (picture: Rgba, threshold = 16): Box | undefined => {
  let left = picture.width
  let top = picture.height
  let right = 0
  let bottom = 0
  for (let row = 0; row < picture.height; row++)
    for (let column = 0; column < picture.width; column++)
      if ((picture.data[(row * picture.width + column) * 4 + 3] ?? 0) > threshold) {
        left = Math.min(left, column)
        top = Math.min(top, row)
        right = Math.max(right, column + 1)
        bottom = Math.max(bottom, row + 1)
      }
  return right > left && bottom > top ? { left, top, right, bottom } : undefined
}

/** A keyed picture cropped to what it shows, with `margin` (a share of its longer side) of room around it. */
export const framed = (picture: Rgba, margin: number): Rgba => {
  const bounds = opaqueBounds(picture)
  if (bounds === undefined) return picture
  const room = Math.round(margin * Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top))
  return crop(picture, {
    left: bounds.left - room,
    top: bounds.top - room,
    right: bounds.right + room,
    bottom: bounds.bottom + room,
  })
}
