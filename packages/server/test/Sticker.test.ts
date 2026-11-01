import { decodePng } from '@styld/imaging'
import { Effect, Option } from 'effect'
import { describe, expect, test } from 'vitest'
import { stickerKey } from '../src/generation/PaintPrompt.ts'
import { fakePainter } from './fakes/Models.ts'
import { stickerOf } from '../src/generation/Sticker.ts'

const painted = (key: 'green' | 'magenta') => Effect.runSync(fakePainter.paint({ prompt: 'a lemon', key }))

describe('a sticker', () => {
  test('is drawn on a key colour the words do not ask for', () => {
    expect(stickerKey('a lemon on a plate')).toBe('green')
    expect(stickerKey('a green apple')).toBe('magenta')
    expect(stickerKey('zelena hruška')).toBe('magenta')
  })

  test('comes out cut out: transparent around what it shows, cropped close to it', () => {
    for (const key of ['green', 'magenta'] as const) {
      const sticker = stickerOf(painted(key), key)
      expect(Option.isSome(sticker)).toBe(true)
      const picture = decodePng(Option.getOrThrow(sticker).bytes)
      expect(picture.width).toBeLessThan(64)
      expect(picture.data[3]).toBe(0)
      const middle = (Math.floor(picture.height / 2) * picture.width + Math.floor(picture.width / 2)) * 4
      expect(picture.data[middle + 3]).toBe(255)
    }
  })

  test('a drawing that does not key out is no sticker', () => {
    expect(Option.isNone(stickerOf(painted('green'), 'magenta'))).toBe(true)
    expect(Option.isNone(stickerOf({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }, 'green'))).toBe(true)
  })
})
