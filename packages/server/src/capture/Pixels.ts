import { decodePng, type Rgba } from '@styld/imaging'
import { Effect } from 'effect'
import { ProviderFailed } from './Providers.ts'

export { decodePng, encodePng, type Rgba } from '@styld/imaging'

/** A rectangle in pixels: `left`/`top` inclusive, `right`/`bottom` exclusive. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** A one-bit mask covering `bounds` of a picture: one byte a pixel, non-zero inside the garment. */
export interface Mask {
  readonly bounds: Box
  readonly raster: Uint8Array
}

/** Decode a PNG a provider made. One that does not decode is the provider's failure, and trying the same
 * picture again would fail the same way. */
export const decodedPng = (bytes: Uint8Array) =>
  Effect.try({
    try: () => decodePng(bytes),
    catch: () => new ProviderFailed({ provider: 'cloudflare-images', retryable: false }),
  })

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

/** The garment alone: the original pixels inside `mask`, transparent elsewhere, cropped to the mask's box. */
export const cutOut = (picture: Rgba, mask: Mask): Rgba => {
  const piece = crop(picture, mask.bounds)
  const maskWidth = mask.bounds.right - mask.bounds.left
  const data = new Uint8Array(piece.data)
  for (let row = 0; row < piece.height; row++)
    for (let column = 0; column < piece.width; column++) {
      const inside = (mask.raster[row * maskWidth + column] ?? 0) !== 0
      if (!inside) data[(row * piece.width + column) * 4 + 3] = 0
    }
  return { width: piece.width, height: piece.height, data }
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

/** How much of the picture is opaque, from 0 to 1. */
export const opaqueShare = (picture: Rgba, threshold = 16): number => {
  let opaque = 0
  for (let pixel = 0; pixel < picture.width * picture.height; pixel++)
    if ((picture.data[pixel * 4 + 3] ?? 0) > threshold) opaque++
  return picture.width * picture.height === 0 ? 0 : opaque / (picture.width * picture.height)
}

/** A mask moved into another picture's pixels: turned a quarter clockwise when the two disagree on
 * portrait or landscape (a phone video's rotation flag), then scaled to the picture's size. */
export const fitMask = (
  mask: Mask,
  from: { readonly width: number; readonly height: number },
  to: { readonly width: number; readonly height: number },
): Mask => {
  const { mask: source, size: sourceSize } = upright(mask, from, to)
  const scaleX = to.width / sourceSize.width
  const scaleY = to.height / sourceSize.height
  const bounds = {
    left: Math.floor(source.bounds.left * scaleX),
    top: Math.floor(source.bounds.top * scaleY),
    right: Math.min(to.width, Math.ceil(source.bounds.right * scaleX)),
    bottom: Math.min(to.height, Math.ceil(source.bounds.bottom * scaleY)),
  }
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  const sourceWidth = source.bounds.right - source.bounds.left
  const sourceHeight = source.bounds.bottom - source.bounds.top
  const raster = new Uint8Array(Math.max(0, width * height))
  // Each pixel takes the source pixel under its centre. One whose centre falls outside the mask's box (the
  // rounded-out edge) stays outside: an index past the row would wrap into the row before.
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      const x = Math.floor((bounds.left + column + 0.5) / scaleX) - source.bounds.left
      const y = Math.floor((bounds.top + row + 0.5) / scaleY) - source.bounds.top
      const inside = x >= 0 && x < sourceWidth && y >= 0 && y < sourceHeight
      raster[row * width + column] = inside ? (source.raster[y * sourceWidth + x] ?? 0) : 0
    }
  return { bounds, raster }
}

/** A mask of a `from` picture turned a quarter clockwise when `from` and `to` disagree on portrait or
 * landscape (a phone video's rotation flag), with the size it is now in. */
export const upright = (
  mask: Mask,
  from: { readonly width: number; readonly height: number },
  to: { readonly width: number; readonly height: number },
) =>
  from.width > from.height !== to.width > to.height
    ? { mask: turnQuarter(mask, from), size: { width: from.height, height: from.width } }
    : { mask, size: from }

/** The mask of a `size` picture turned a quarter clockwise. */
const turnQuarter = (mask: Mask, size: { readonly width: number; readonly height: number }): Mask => {
  const width = mask.bounds.right - mask.bounds.left
  const height = mask.bounds.bottom - mask.bounds.top
  const raster = new Uint8Array(width * height)
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++)
      raster[column * height + (height - 1 - row)] = mask.raster[row * width + column] ?? 0
  return {
    bounds: {
      left: size.height - mask.bounds.bottom,
      top: mask.bounds.left,
      right: size.height - mask.bounds.top,
      bottom: mask.bounds.right,
    },
    raster,
  }
}
