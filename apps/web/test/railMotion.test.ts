import { describe, expect, test } from 'vitest'
import {
  advance,
  aim,
  frameAt,
  mobileRailPositions,
  playhead,
  rackPositions,
  slideStep,
  swipeDestination,
} from '../src/page/RailMotion.ts'

// The landing rail's motion (RailMotion.ts): a piece turns smoothly to its front and back, reverses mid-way without a
// jump, and the rail makes room around the piece that turns.

const timing = { turnMs: 900, returnMs: 500, endpointWindow: 0.3 }

/** Run a playhead for `ms` in 16 ms frames, keeping every position it passes. */
const run = (head: ReturnType<typeof playhead>, ms: number) => {
  const seen: Array<number> = []
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    advance(head, 16, timing)
    seen.push(head.position)
  }
  return seen
}

describe('a piece turning on its hanger', () => {
  test('turns from its side to its front in about its turn time, never overshooting, and lands on the last frame', () => {
    const head = playhead()
    aim(head, 1, timing)
    const seen = run(head, 1000)
    expect(seen.every((position, index) => index === 0 || position >= (seen[index - 1] ?? 0) - 1e-9)).toBe(true)
    expect(head.position).toBe(1)
    expect(head.segment).toBeUndefined()
    expect(frameAt(head, 30)).toBe(29)
  })

  test('sent back mid-turn, it brakes and returns from where it was, with no jump', () => {
    const head = playhead()
    aim(head, 1, timing)
    run(head, 300)
    const midway = head.position
    expect(midway).toBeGreaterThan(0.1)
    expect(midway).toBeLessThan(0.95)
    aim(head, 0, timing)
    advance(head, 16, timing)
    expect(Math.abs(head.position - midway)).toBeLessThan(0.08)
    run(head, 800)
    expect(head.position).toBe(0)
  })

  test('with reduced motion it is at once where it is sent', () => {
    const head = playhead()
    aim(head, 1, timing, true)
    expect(head.position).toBe(1)
    expect(advance(head, 16, timing)).toBe(false)
  })
})

describe('the rail', () => {
  test('spaces the pieces evenly, and moves the neighbours aside of the one turned to the front', () => {
    const rest = rackPositions({ count: 5, width: 1000, garmentWidth: 370, active: -1, minimumSpread: 35 })
    expect(rest).toEqual([100, 300, 500, 700, 900])
    const turned = rackPositions({ count: 5, width: 1000, garmentWidth: 370, active: 2, minimumSpread: 35 })
    expect(turned[2]).toBe(500)
    expect((turned[1] ?? 0) < 300 && (turned[3] ?? 0) > 700).toBe(true)
    expect(turned.every((position) => position >= 0 && position <= 1000)).toBe(true)
  })

  test('on a phone keeps the focused piece in the middle, and a flick moves to the next; a slide settles', () => {
    const positions = mobileRailPositions({ width: 390, halves: [100, 30, 30, 30, 30], focus: 0, offset: 0, gap: 12 })
    expect(positions[0]).toBe(195)
    expect((positions[1] ?? 0) - (positions[0] ?? 0)).toBeGreaterThanOrEqual(142)
    expect(swipeDestination({ positions, width: 390, focus: 0, delta: -40, velocity: -0.6 })).toBe(1)
    expect(swipeDestination({ positions, width: 390, focus: 0, delta: -10, velocity: -0.1 })).toBe(0)
    let slide = { position: 120, velocity: 0 }
    for (let frame = 0; frame < 120; frame++) slide = slideStep(slide.position, slide.velocity, 0, 16)
    expect(slide).toEqual({ position: 0, velocity: 0 })
  })
})
