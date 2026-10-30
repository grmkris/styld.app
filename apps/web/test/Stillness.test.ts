import { describe, expect, test } from 'vitest'
import { settlingOf, startWatch, type Watch, watchFrame } from '../src/capture/Stillness.ts'

const frame = (value: number) => new Uint8Array(64).fill(value)

/** Feed frames in order and return the indices at which the scene settled, and how. */
const settlesWith = (frames: ReadonlyArray<Uint8Array>) => {
  let watch: Watch = startWatch
  return frames.flatMap((grey, index) => {
    const next = watchFrame(watch, grey)
    watch = next.watch
    return next.settle === undefined ? [] : [[index, next.settle] as const]
  })
}

const settles = (frames: ReadonlyArray<Uint8Array>) => settlesWith(frames).map(([index]) => index)

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

  test("the shutter's ring fills in quarters as a moved scene calms, and empties once it settles", () => {
    let watch: Watch = startWatch
    const levels = [frame(100), frame(170), frame(170), frame(170), frame(170), frame(170)].map((grey) => {
      watch = watchFrame(watch, grey).watch
      return settlingOf(watch)
    })
    // Nothing moved yet, then moving, then three still frames settle it.
    expect(levels).toEqual([0, 0, 1, 3, 0, 0])
  })

  test('a garment held by hand that never stops swaying still settles, after about a second', () => {
    const moving = [frame(100), frame(170)]
    const swaying = Array.from({ length: 6 }, (_frame, index) => frame(index % 2 === 0 ? 176 : 170))
    expect(settles([...moving, ...swaying])).toEqual([6])
  })

  test('a scene that stays put is looked at twice more, then waits until something moves', () => {
    const moving = [frame(100), frame(170)]
    const held = Array.from({ length: 60 }, () => frame(170))
    expect(settlesWith([...moving, ...held])).toEqual([
      [4, 'settled'],
      [16, 'again'],
      [28, 'again'],
    ])
    const movedAgain = [...moving, ...held, frame(90), ...Array.from({ length: 4 }, () => frame(90))]
    expect(settlesWith(movedAgain).at(-1)).toEqual([65, 'settled'])
  })

  test('a slight sway neither shoots nor resets the moment', () => {
    const moving = [frame(100), frame(160)]
    const swaying = [frame(161), frame(166), frame(161), frame(162), frame(161)]
    // 160→161 is still, then two sways that neither count nor reset, then two still frames finish the count.
    expect(settles([...moving, ...swaying])).toEqual([6])
  })
})
