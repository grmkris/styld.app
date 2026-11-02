import { readFileSync } from 'node:fs'
import { chromaKey, flatten, keyColourFor, shrink, type Rgba } from '@styld/imaging'
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'
import { decodePng } from '@styld/imaging'

const fixture = (name: string) =>
  decodePng(new Uint8Array(readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url))))

/** The drawn red tee laid on flat green through its true outline, soft at the edge: what an image model returns. */
const teeOnGreen = () => {
  const tee = fixture('red-tee.png')
  const truth = fixture('red-tee-truth.png')
  const data = new Uint8Array(tee.data.length)
  for (let at = 0; at < data.length; at += 4) {
    const alpha = (truth.data[at] ?? 0) / 255
    data[at] = Math.round((tee.data[at] ?? 0) * alpha)
    data[at + 1] = Math.round((tee.data[at + 1] ?? 0) * alpha + 255 * (1 - alpha))
    data[at + 2] = Math.round((tee.data[at + 2] ?? 0) * alpha)
    data[at + 3] = 255
  }
  return { picture: { width: tee.width, height: tee.height, data }, truth }
}

const opaqueAt = (picture: Rgba, at: number) => (picture.data[at * 4 + 3] ?? 0) > 127

const keyed = (picture: Rgba, key: 'green' | 'magenta') =>
  Option.getOrThrowWith(chromaKey(picture, key), () => new Error('the key failed its checks'))

/** A red square on green, its left rim half red and half green: the edge of a red garment on the key. */
const squareColourAt = (x: number, y: number) => {
  if (y < 5 || y >= 15) return [0, 255, 0, 255]
  if (x === 4) return [100, 142, 20, 255]
  return x >= 5 && x < 15 ? [200, 30, 40, 255] : [0, 255, 0, 255]
}

describe('keying a drawn picture', () => {
  test("gives back the red tee's own outline from flat green", () => {
    const { picture, truth } = teeOnGreen()
    const result = keyed(picture, 'green')
    let both = 0
    let either = 0
    for (let at = 0; at < truth.width * truth.height; at++) {
      const inTruth = (truth.data[at * 4] ?? 0) > 127
      const inKey = opaqueAt(result, at)
      if (inTruth && inKey) both += 1
      if (inTruth || inKey) either += 1
    }
    expect(both / either).toBeGreaterThanOrEqual(0.98)
  })

  test('takes the key colour back out of an edge pixel, so no green fringe remains', () => {
    const square = { width: 20, height: 20, data: new Uint8Array(1600) }
    for (let at = 0; at < 400; at++) square.data.set(squareColourAt(at % 20, Math.floor(at / 20)), at * 4)
    const result = keyed(square, 'green')
    const rim = (10 * 20 + 4) * 4
    expect(result.data[rim + 3]).toBeGreaterThan(0)
    expect(result.data[rim + 3]).toBeLessThan(255)
    expect(result.data[rim + 1] ?? 0).toBeLessThan(result.data[rim] ?? 0)
  })

  test("keys a real Muse picture's magenta background, with the shirt whole and no magenta fringe", () => {
    const picture = fixture('muse-green-shirt.png')
    const result = keyed(picture, 'magenta')
    expect(result.data[3]).toBe(0)
    expect(opaqueAt(result, (picture.height / 2) * picture.width + picture.width / 2)).toBe(true)
    let fringe = 0
    let soft = 0
    for (let at = 0; at < result.data.length; at += 4) {
      const alpha = result.data[at + 3] ?? 0
      if (alpha === 0 || alpha === 255) continue
      soft += 1
      const magenta = Math.min(result.data[at] ?? 0, result.data[at + 2] ?? 0) - (result.data[at + 1] ?? 0)
      if (magenta > 60) fringe += 1
    }
    expect(soft).toBeGreaterThan(0)
    expect(fringe / soft).toBeLessThan(0.05)
  })

  test('fails when the border is not the key colour, or when nothing of a garment remains', () => {
    expect(Option.isNone(chromaKey(fixture('red-tee.png'), 'green'))).toBe(true)
    const green = { width: 40, height: 40, data: new Uint8Array(40 * 40 * 4) }
    for (let at = 0; at < 1600; at++) green.data.set([0, 255, 0, 255], at * 4)
    expect(Option.isNone(chromaKey(green, 'green'))).toBe(true)
  })

  test('keys a million pixels quickly enough for a queue job', () => {
    const { picture } = teeOnGreen()
    const big = { width: 1000, height: 1000, data: new Uint8Array(4_000_000) }
    for (let y = 0; y < 1000; y++)
      for (let x = 0; x < 1000; x++) {
        const from =
          (Math.floor((y * picture.height) / 1000) * picture.width + Math.floor((x * picture.width) / 1000)) * 4
        big.data.set(picture.data.subarray(from, from + 4), (y * 1000 + x) * 4)
      }
    const started = performance.now()
    keyed(big, 'green')
    expect(performance.now() - started).toBeLessThan(1500)
  })
})

describe('the key colour for a garment', () => {
  test('is magenta for a green shirt and green otherwise', () => {
    expect(keyColourFor(fixture('green-shirt.png'))).toBe('magenta')
    expect(keyColourFor(fixture('red-tee.png'))).toBe('green')
  })
})

describe('shrinking and flattening a cut-out', () => {
  test('averages down to the longest edge and lays transparency on grey', () => {
    const picture = { width: 4, height: 2, data: new Uint8Array(32) }
    for (let at = 0; at < 8; at++) picture.data.set(at % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 0], at * 4)
    const small = shrink(picture, 2)
    expect([small.width, small.height]).toEqual([2, 1])
    expect([...small.data.subarray(0, 4)]).toEqual([128, 0, 128, 128])
    expect(shrink(picture, 10)).toBe(picture)
    expect([...flatten(picture).data.subarray(4, 8)]).toEqual([236, 236, 236, 255])
  })
})
