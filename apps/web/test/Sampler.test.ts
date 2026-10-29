import { describe, expect, test } from 'vitest'
import { stillTimes, tileSharpness } from '../src/capture/Sampler.ts'

describe('sampling a video', () => {
  test('takes a still every half second up to 30 s, and every second up to a minute', () => {
    expect(stillTimes(2000)).toEqual([0, 500, 1000, 1500])
    expect(stillTimes(30_000)).toHaveLength(60)
    expect(stillTimes(60_000)).toHaveLength(60)
    expect(stillTimes(60_000).at(-1)).toBe(59_000)
  })

  test('scores a sharp tile above a flat one, each between 0 and 1', () => {
    const width = 64
    const height = 64
    const grey = new Uint8Array(width * height)
    // A checkerboard in the top-left tile only; the rest is flat grey.
    for (let row = 0; row < height; row++)
      for (let column = 0; column < width; column++)
        grey[row * width + column] = row < 8 && column < 8 ? ((row + column) % 2) * 255 : 128
    const sharpness = tileSharpness(grey, width, height)
    expect(sharpness).toHaveLength(64)
    expect(sharpness[0]).toBeGreaterThan(0.9)
    expect(sharpness[63]).toBe(0)
    expect(sharpness.every((value) => value >= 0 && value <= 1)).toBe(true)
  })
})
