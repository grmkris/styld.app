import { encodePng } from '@styld/imaging'
import { describe, expect, test } from 'vitest'
import { coloursOf, mapPiece, nameOf, pictureRefusal, typeOf, type V1Piece } from './Mapping.ts'

// Anonymized fixtures: made-up ids, names and colour words of the shapes v1 stored, and pictures built here.

/** A PNG of `width` by `height` whose pixels vary, so it does not compress to a few bytes. */
const png = (width: number, height: number) => {
  const data = new Uint8Array(width * height * 4)
  let seed = 7
  for (let index = 0; index < data.length; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    data[index] = index % 4 === 3 ? 255 : seed % 256
  }
  return encodePng({ width, height, data })
}

/** A JPEG's first bytes: its start, an APP0 segment and a baseline frame header of the size, padded out. */
const jpeg = (width: number, height: number, length = 4096) => {
  const bytes = new Uint8Array(length)
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new TextEncoder().encode('JFIF'), 0, 1, 1, 0])
  bytes.set([0, 1, 0, 1, 0, 0], 14)
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3], 20)
  return bytes
}

/** The 1×1 lossless WebP v1 kept for a piece whose photo never arrived. */
const placeholderWebp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x0d, 0x00, 0x00,
  0x00, 0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00,
])

const piece = (changes: Partial<V1Piece> = {}): V1Piece => ({
  id: 'clothingItem_01aaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Wool jumper',
  category: 'top',
  colours: ['cream', 'navy stitching'],
  picture: 'pictures/clothingItem_01aaaaaaaaaaaaaaaaaaaaaaaa',
  mime: 'image/jpeg',
  ...changes,
})

describe('a v1 piece', () => {
  test('takes the type nearest its category, narrowed by its name within the same place', () => {
    expect(typeOf('top', 'Wool jumper')).toBe('knitwear')
    expect(typeOf('top', 'Linen shirt')).toBe('shirts')
    expect(typeOf('top', null)).toBe('tops')
    expect(typeOf('bottom', 'Mom jeans')).toBe('jeans')
    expect(typeOf('bottom', 'Pleated skirt')).toBe('skirts')
    expect(typeOf('outerwear', 'Long trench coat')).toBe('coats')
    expect(typeOf('shoes', 'Chelsea boots')).toBe('boots')
    expect(typeOf('shoes', 'White sneakers')).toBe('trainers')
    expect(typeOf('accessory', 'Leather belt')).toBe('belts')
    // A name never moves a piece out of its category's place, and no category starts as a top.
    expect(typeOf('shoes', 'Boot-cut jeans')).toBe('boots')
    expect(typeOf('bottom', 'Ankle boots')).toBe('trousers')
    expect(typeOf(null, 'Something')).toBe('tops')
  })

  test('takes the colours its words name, at most six, never a detail’s', () => {
    expect(coloursOf(['Cream', 'navy stitching', 'dark blue'])).toEqual(['beige', 'navy'])
    expect(coloursOf(['black', 'Black', 'gold hardware', 'charcoal'])).toEqual(['black', 'grey'])
    expect(coloursOf(['mauve'])).toEqual([])
  })

  test('keeps its name trimmed, folded and cut to a name’s length, and none when it is blank', () => {
    expect(nameOf('  Wool   jumper ')).toBe('Wool jumper')
    expect(nameOf('   ')).toBeUndefined()
    expect(nameOf(null)).toBeUndefined()
    expect(nameOf('x'.repeat(200))?.length).toBe(80)
  })

  test('refuses a placeholder, a picture too small, and bytes that are no picture', () => {
    expect(pictureRefusal(placeholderWebp)).toBe('placeholder')
    expect(pictureRefusal(png(32, 600))).toBe('placeholder')
    expect(pictureRefusal(jpeg(1, 1))).toBe('placeholder')
    expect(pictureRefusal(new TextEncoder().encode('<html>not found</html>'.repeat(100)))).toBe('notAPicture')
    expect(pictureRefusal(png(200, 300))).toBeUndefined()
    expect(pictureRefusal(jpeg(1200, 1600))).toBeUndefined()
  })

  test('maps to a piece to import, or a refusal the report lists', () => {
    expect(mapPiece(piece(), jpeg(1200, 1600))).toEqual({
      _tag: 'Mapped',
      piece: {
        v1Id: 'clothingItem_01aaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Wool jumper',
        type: 'knitwear',
        colours: ['beige'],
        picture: 'pictures/clothingItem_01aaaaaaaaaaaaaaaaaaaaaaaa',
        contentType: 'image/jpeg',
      },
    })
    expect(mapPiece(piece({ name: ' ', id: 'clothingItem/02' }), png(200, 300))).toMatchObject({
      _tag: 'Mapped',
      piece: { v1Id: 'clothingItem/02', picture: 'pictures/clothingItem_02', contentType: 'image/png' },
    })
    expect(mapPiece(piece(), placeholderWebp)).toEqual({
      _tag: 'Refused',
      v1Id: 'clothingItem_01aaaaaaaaaaaaaaaaaaaaaaaa',
      reason: 'placeholder',
    })
  })
})
