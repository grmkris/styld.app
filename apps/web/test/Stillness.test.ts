import { describe, expect, test } from 'vitest'
import { startWatch, type Watch, watchFrame } from '../src/capture/Stillness.ts'

const frame = (value: number) => new Uint8Array(64).fill(value)

/** Feed frames in order and return the indices at which the scene settled. */
const settles = (frames: ReadonlyArray<Uint8Array>) => {
  let watch: Watch = startWatch
  return frames.flatMap((grey, index) => {
    const next = watchFrame(watch, grey)
    watch = next.watch
    return next.settled ? [index] : []
  })
}

describe('watching for a garment held still', () => {
  test('an empty, unchanging room never shoots', () => {
    expect(settles(Array.from({ length: 20 }, () => frame(100)))).toEqual([])
  })

  test('a garment brought in and held still shoots once, after a moment', () => {
    const empty = [frame(100), frame(100)]
    const moving = [frame(160), frame(90), frame(170)]
    const held = Array.from({ length: 8 }, () => frame(170))
    expect(settles([...empty, ...moving, ...held])).toEqual([7])
  })

  test('a slight sway neither shoots nor resets the moment', () => {
    const moving = [frame(100), frame(160)]
    const swaying = [frame(161), frame(166), frame(161), frame(162), frame(161)]
    // 160→161 is still, then two sways that neither count nor reset, then two still frames finish the count.
    expect(settles([...moving, ...swaying])).toEqual([6])
  })
})
