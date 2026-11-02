import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { refinedCutOut } from '../src/capture/Matte.ts'
import { decodePng } from '@styld/imaging'
import type { Box, Rgba } from '@styld/imaging'
import { cutOut, fitMask, type Mask } from '../src/capture/Pixels.ts'
import { makeOutputLines, stillMasks } from '../src/providers/SamStream.ts'

const fixture = (name: string) => readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url))

/** The recorded SAM answer for the drawn red tee, read the way the adapter reads it. */
const teeMask = () => {
  const reader = makeOutputLines()
  const lines = [...reader.push(fixture('sam-still-red-tee.sse').toString('utf8')), ...reader.finish().lines]
  const [mask] = stillMasks(lines)
  if (mask === undefined) throw new Error('the recording holds the tee')
  return mask
}

/** A mask at half the resolution, as SAM sends for a picture larger than its frame. */
const halved = (mask: Mask): Mask => {
  const bounds = {
    left: Math.floor(mask.bounds.left / 2),
    top: Math.floor(mask.bounds.top / 2),
    right: Math.ceil(mask.bounds.right / 2),
    bottom: Math.ceil(mask.bounds.bottom / 2),
  }
  const width = bounds.right - bounds.left
  const fullWidth = mask.bounds.right - mask.bounds.left
  const raster = new Uint8Array(width * (bounds.bottom - bounds.top))
  for (let y = 0; y < bounds.bottom - bounds.top; y++)
    for (let x = 0; x < width; x++) {
      const fy = Math.min(mask.bounds.bottom - 1, 2 * (bounds.top + y)) - mask.bounds.top
      const fx = Math.min(mask.bounds.right - 1, 2 * (bounds.left + x)) - mask.bounds.left
      raster[y * width + x] = fy < 0 || fx < 0 ? 0 : (mask.raster[fy * fullWidth + fx] ?? 0)
    }
  return { bounds, raster }
}

/** The opacity a cut-out placed at `bounds` shows at a picture pixel, 0 to 1. */
const opacityAt = (piece: Rgba, bounds: Box, x: number, y: number) =>
  x < bounds.left || y < bounds.top || x >= bounds.right || y >= bounds.bottom
    ? 0
    : (piece.data[((y - bounds.top) * piece.width + x - bounds.left) * 4 + 3] ?? 0) / 255

/** Mean distance from the true opacity over the pixels within 4 px of the true outline. */
const edgeError = (truth: Rgba, piece: Rgba, bounds: Box) => {
  const inside = (x: number, y: number) => (truth.data[(y * truth.width + x) * 4] ?? 0) > 127
  let sum = 0
  let count = 0
  for (let y = 4; y < truth.height - 4; y++)
    for (let x = 4; x < truth.width - 4; x++) {
      const here = inside(x, y)
      const nearEdge = [-4, 4].some((d) => inside(x + d, y) !== here || inside(x, y + d) !== here)
      if (!nearEdge) continue
      sum += Math.abs(opacityAt(piece, bounds, x, y) - (truth.data[(y * truth.width + x) * 4] ?? 0) / 255)
      count++
    }
  return sum / count
}

const within = (box: Box | undefined, x: number, y: number) =>
  box !== undefined && x >= box.left && x < box.right && y >= box.top && y < box.bottom

/** A flat picture with a dark garment on a light ground, and a different colour inside `hand`. */
const drawn = (size: number, garment: Box, hand?: Box): Rgba => {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const colour = within(hand, x, y) ? [220, 170, 140] : within(garment, x, y) ? [40, 30, 120] : [200, 200, 190]
      data.set([...colour, 255], (y * size + x) * 4)
    }
  return { width: size, height: size, data }
}

const maskOf = (size: number, inside: (x: number, y: number) => boolean): Mask => {
  const raster = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raster[y * size + x] = inside(x, y) ? 1 : 0
  return { bounds: { left: 0, top: 0, right: size, bottom: size }, raster }
}

describe('refined cut-outs', () => {
  test("a mask at half the picture's resolution comes out closer to the tee's true outline than stepped scaling", () => {
    const picture = decodePng(new Uint8Array(fixture('red-tee.png')))
    const truth = decodePng(new Uint8Array(fixture('red-tee-truth.png')))
    const coarse = halved(teeMask())
    const half = { width: picture.width / 2, height: picture.height / 2 }
    const stepped = fitMask(coarse, half, picture)
    const steppedError = edgeError(truth, cutOut(picture, stepped), stepped.bounds)
    const refined = refinedCutOut(picture, coarse, half)
    const refinedError = edgeError(truth, refined.piece, refined.bounds)
    expect(refinedError).toBeLessThan(0.25 * steppedError)
  })

  test('drops a speck apart from the garment and fills a pinhole, but keeps the hole a hand left', () => {
    const garment = { left: 40, top: 40, right: 160, bottom: 160 }
    const hand = { left: 90, top: 60, right: 110, bottom: 80 }
    const picture = drawn(200, garment, hand)
    const mask = maskOf(200, (x, y) => {
      const inGarment = x >= 40 && x < 160 && y >= 40 && y < 160
      const inHand = x >= 90 && x < 110 && y >= 60 && y < 80
      const pinhole = x >= 70 && x < 72 && y >= 120 && y < 122
      const speck = x >= 5 && x < 7 && y >= 5 && y < 7
      return (inGarment && !inHand && !pinhole) || speck
    })
    const { piece, bounds } = refinedCutOut(picture, mask, { width: 200, height: 200 })
    expect(opacityAt(piece, bounds, 6, 6)).toBe(0)
    expect(opacityAt(piece, bounds, 70, 120)).toBe(1)
    expect(opacityAt(piece, bounds, 100, 70)).toBe(0)
    expect(opacityAt(piece, bounds, 130, 130)).toBe(1)
  })

  test("moves SAM's edge at most a few pixels, so a cut-out never reaches into a neighbour", () => {
    // SAM's mask stops 10 px short of the garment's real right edge.
    const picture = drawn(200, { left: 40, top: 40, right: 160, bottom: 160 })
    const mask = maskOf(200, (x, y) => x >= 40 && x < 150 && y >= 40 && y < 160)
    const { piece, bounds } = refinedCutOut(picture, mask, { width: 200, height: 200 })
    for (let y = 50; y < 150; y += 10) {
      expect(opacityAt(piece, bounds, 155, y)).toBe(0)
      expect(opacityAt(piece, bounds, 100, y)).toBe(1)
    }
  })

  test("takes a soft edge's colour from the garment, not from the ground behind it", () => {
    const size = 120
    const picture = drawn(size, { left: 30, top: 30, right: 90, bottom: 90 })
    // A coarse mask at a third of the resolution, so the spread edge is soft.
    const coarse = maskOf(size / 3, (x, y) => x >= 10 && x < 30 && y >= 10 && y < 30)
    const { piece } = refinedCutOut(picture, coarse, { width: size / 3, height: size / 3 })
    const edge = Array.from({ length: piece.width * piece.height }, (_pixel, at) => at).filter((at) => {
      const alpha = piece.data[at * 4 + 3] ?? 0
      return alpha > 0 && alpha < 255
    })
    for (const at of edge) expect(piece.data[at * 4 + 2] ?? 0).toBeGreaterThan(100)
  })
})
