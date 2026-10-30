import {
  armsRow,
  clipAbove,
  opaqueBounds,
  packSheet,
  pickedFrames,
  type Rgba,
  sheetLayout,
  silhouetteWidth,
  turnEnd,
} from '@styld/imaging'
import { describe, expect, test } from 'vitest'

/** A 360 by 640 frame: a garment `width` wide from row 100 to 600 under a 6-pixel stem from row 60. */
const frame = (width: number): Rgba => {
  const data = new Uint8Array(360 * 640 * 4)
  for (let y = 60; y < 600; y++)
    for (let x = 0; x < 360; x++) {
      const half = y < 100 ? 3 : width / 2
      if (Math.abs(x - 180) < half) data.set([200, 30, 40, 255], (y * 360 + x) * 4)
    }
  return { width: 360, height: 640, data }
}

describe('where a turn stops', () => {
  test('is the first frame within 97% of the final width, whatever the cloth does after', () => {
    const widths = [
      ...Array.from({ length: 40 }, (_, at) => 60 + at * 5),
      ...Array.from({ length: 56 }, (_, at) => 258 + (at % 3)),
    ]
    expect(turnEnd(widths)).toBe(39)
    expect(pickedFrames(39, 30)).toHaveLength(30)
    expect([pickedFrames(39, 30)[0], pickedFrames(39, 30)[29]]).toEqual([0, 39])
  })
})

describe('the hook above the hanger', () => {
  test('is cut at the first row wider than a sliver of the frame', () => {
    const picture = frame(200)
    expect(armsRow(picture)).toBe(100)
    expect(opaqueBounds(clipAbove(picture, armsRow(picture)), 128)?.top).toBe(99)
    expect(silhouetteWidth(picture)).toBe(199)
  })
})

describe('a frame sheet', () => {
  test('packs 30 frames into 6 columns about one pivot, every garment whole in its cell', () => {
    const frames = Array.from({ length: 30 }, (_, at) => clipAbove(frame(60 + at * 7), 100))
    const sheet = packSheet(frames)
    expect([sheet?.width, sheet?.height]).toEqual([6 * sheetLayout.width, 5 * sheetLayout.height])
    if (sheet === undefined) throw new Error('no sheet')
    const alpha = (x: number, y: number) => sheet.data[(y * sheet.width + x) * 4 + 3] ?? 0
    // The pivot, the middle of the top: each cell shows its garment just below it, and nothing at its edges.
    for (const index of [0, 14, 29]) {
      const left = (index % 6) * sheetLayout.width
      const top = Math.floor(index / 6) * sheetLayout.height
      expect(alpha(left + sheetLayout.width / 2, top + 20)).toBeGreaterThan(128)
      expect(alpha(left + 2, top + sheetLayout.height / 2)).toBe(0)
      expect(alpha(left + sheetLayout.width / 2, top + sheetLayout.height - 2)).toBe(0)
    }
    expect(
      packSheet([...frames.slice(1), { width: 360, height: 640, data: new Uint8Array(360 * 640 * 4) }]),
    ).toBeUndefined()
  })
})
