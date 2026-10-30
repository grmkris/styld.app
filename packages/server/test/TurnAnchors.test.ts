import { fitSide, frontAnchor, onKey, opaqueBounds, type Rgba, scaled, turnCanvas } from '@styld/imaging'
import { describe, expect, test } from 'vitest'
import { hanger } from '../src/capture/Hanger.ts'

/** An oval of `colour` on transparency, `width` by `height`. */
const oval = (width: number, height: number, colour: readonly [number, number, number]): Rgba => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = ((x - width / 2) / (width / 2)) ** 2 + ((y - height / 2) / (height / 2)) ** 2 <= 1
      if (inside) data.set([...colour, 255], (y * width + x) * 4)
    }
  return { width, height, data }
}

const alphaAt = (picture: Rgba, x: number, y: number) => picture.data[(y * picture.width + x) * 4 + 3] ?? 0

describe("a turn's front anchor", () => {
  test('puts the clean picture top-centred on the 720 by 1280 canvas, under the wooden hanger', () => {
    const anchor = frontAnchor(oval(400, 600, [200, 30, 40]), hanger())
    expect([anchor.width, anchor.height]).toEqual([turnCanvas.width, turnCanvas.height])
    const box = opaqueBounds(anchor, 20)
    // The garment fills 560 by 860 (here 560 wide, so 840 tall) from row 230; the hanger's wood shows above it.
    expect(box?.top).toBeLessThan(230)
    expect(Math.abs((box?.bottom ?? 0) - (230 + 840))).toBeLessThanOrEqual(2)
    expect(Math.abs((box?.left ?? 0) + (box?.right ?? 0) - turnCanvas.width)).toBeLessThanOrEqual(4)
    expect(alphaAt(anchor, 360, 600)).toBe(255)
    expect(alphaAt(anchor, 5, 5)).toBe(0)
  })

  test('lies on its flat key colour for the models, opaque everywhere', () => {
    const keyed = onKey(frontAnchor(oval(400, 600, [40, 150, 60]), hanger()), 'magenta')
    expect([...keyed.data.subarray(0, 4)]).toEqual([255, 0, 255, 255])
    const middle = (600 * keyed.width + 360) * 4
    expect([...keyed.data.subarray(middle, middle + 4)]).toEqual([40, 150, 60, 255])
  })
})

describe("a turn's side view", () => {
  test('is scaled to the front’s length, its apex on the middle column at the front’s top', () => {
    const front = frontAnchor(oval(400, 600, [200, 30, 40]), hanger())
    const side = oval(300, 1400, [200, 30, 40])
    const fitted = fitSide({ ...side }, front)
    const frontBox = opaqueBounds(front, 20)
    const sideBox = fitted === undefined ? undefined : opaqueBounds(fitted, 20)
    expect(Math.abs((sideBox?.top ?? 0) - (frontBox?.top ?? 0))).toBeLessThanOrEqual(2)
    expect(Math.abs((sideBox?.bottom ?? 0) - (frontBox?.bottom ?? 0))).toBeLessThanOrEqual(3)
    expect(Math.abs((sideBox?.left ?? 0) + (sideBox?.right ?? 0) - turnCanvas.width)).toBeLessThanOrEqual(6)
    expect(fitSide({ width: 4, height: 4, data: new Uint8Array(64) }, front)).toBeUndefined()
  })

  test('scales up by blending and down by averaging', () => {
    const square = oval(10, 10, [10, 20, 30])
    expect([scaled(square, 2).width, scaled(square, 0.5).width]).toEqual([20, 5])
  })
})
