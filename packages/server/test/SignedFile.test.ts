import { describe, expect, test } from 'vitest'
import { byteRange } from '../src/wardrobe/SignedFile.ts'

describe('single byte ranges', () => {
  test.each([
    ['bytes=0-31', 100, { offset: 0, length: 32 }],
    ['bytes=20-200', 100, { offset: 20, length: 80 }],
    ['bytes=90-', 100, { offset: 90, length: 10 }],
    ['bytes=-16', 100, { offset: 84, length: 16 }],
    ['bytes=-200', 100, { offset: 0, length: 100 }],
    ['bytes=0-0', 100, { offset: 0, length: 1 }],
  ] as const)('bounds %s within %i bytes', (header, size, expected) => {
    expect(byteRange(header, size)).toEqual(expected)
  })

  test.each([
    'bytes=100-',
    'bytes=30-20',
    'bytes=-0',
    'bytes=-',
    'bytes=0-2,5-8',
    'items=0-5',
    'bytes=999999999999999999999-',
  ])('refuses %s', (header) => {
    expect(byteRange(header, 100)).toBeUndefined()
  })

  test('refuses every range of an empty object', () => {
    expect(byteRange('bytes=0-', 0)).toBeUndefined()
  })
})
