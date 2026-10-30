import { describe, expect, test } from 'vitest'
import { fitWithin, frameTimes, isStill, longestVideoMs, planParts } from '../src/capture/PartPlan.ts'

describe('cutting a video into parts', () => {
  test('30-second parts, a short tail joined to the part before it', () => {
    expect(planParts(13 * 60_000)).toHaveLength(26)
    expect(planParts(61_000)).toEqual([
      { index: 0, startMs: 0, endMs: 30_000 },
      { index: 1, startMs: 30_000, endMs: 61_000 },
    ])
    // A 40-second video keeps a 10 s tail with its first part: Meta bills 50 frames at least.
    expect(planParts(40_000)).toEqual([{ index: 0, startMs: 0, endMs: 40_000 }])
    expect(planParts(75_000).map(({ endMs }) => endMs)).toEqual([30_000, 60_000, 75_000])
    expect(planParts(900_000)).toHaveLength(30)
    expect(planParts(500)).toEqual([{ index: 0, startMs: 0, endMs: 500 }])
    expect(planParts(0)).toEqual([])
    expect(longestVideoMs).toBe(901_000)
  })

  test('a part has a frame every 250 ms and a still every second', () => {
    const times = frameTimes({ index: 1, startMs: 30_000, endMs: 60_000 })
    expect(times).toHaveLength(120)
    expect(times.slice(0, 3)).toEqual([30_000, 30_250, 30_500])
    expect(times.filter((_, frame) => isStill(frame))).toHaveLength(30)
    expect(frameTimes({ index: 0, startMs: 0, endMs: 40_000 })).toHaveLength(160)
  })

  test('sizes fit the long edge, never grow, and stay even', () => {
    expect(fitWithin(1080, 1920, 720)).toEqual({ width: 406, height: 720 })
    expect(fitWithin(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 })
    expect(fitWithin(320, 180, 720)).toEqual({ width: 320, height: 180 })
    expect(fitWithin(321, 181, 720)).toEqual({ width: 322, height: 182 })
  })
})
