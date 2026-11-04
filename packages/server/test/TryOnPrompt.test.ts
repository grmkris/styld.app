import { describe, expect, it } from '@effect/vitest'
import { maximumTryOnPieces, StartTryOn } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { tryOnPrompt, tryOnSize, tryOnWords } from '../src/generation/TryOnPrompt.ts'
import { sendable } from '../src/generation/TryOnShared.ts'
import { tryOnBody } from '../src/providers/Muse.ts'

const picture = (byte: number, contentType: 'image/jpeg' | 'image/webp') => ({
  bytes: new Uint8Array([byte]),
  contentType,
})

describe('a try-on request', () => {
  it('names each piece by its colours and type only, never by the words a person gave it', () => {
    expect(tryOnWords({ type: 'shirts', colours: ['navy', 'white', 'red'] })).toBe('navy and white shirt')
    expect(tryOnWords({ type: 'trainers', colours: [] })).toBe('trainers')
    expect(tryOnWords({ type: 'knitwear', colours: ['grey'] })).toBe('grey knitted top')
  })

  it('numbers the pieces from image 2, after the photo, and asks to keep the person and the scene', () => {
    const prompt = tryOnPrompt(['navy blazer', 'white t-shirt'])
    expect(prompt).toContain('Image 1 is a photo of me')
    expect(prompt).toContain('- Image 2: navy blazer\n- Image 3: white t-shirt')
    expect(prompt).toContain('my face and identity')
    expect(prompt).not.toContain('Image 4')
  })

  it('draws on the canvas closest to the photo, so the result keeps its framing', () => {
    expect(tryOnSize({ width: 768, height: 1024 })).toBe('1152x1536')
    expect(tryOnSize({ width: 3024, height: 4032 })).toBe('1152x1536')
    expect(tryOnSize({ width: 1080, height: 1920 })).toBe('1152x2048')
    expect(tryOnSize({ width: 1000, height: 1000 })).toBe('1024x1024')
    expect(tryOnSize({ width: 4032, height: 3024 })).toBe('1536x1152')
    expect(tryOnSize(undefined)).toBe('1152x1536')
    expect(tryOnSize({ width: 0, height: 0 })).toBe('1152x1536')
  })

  it('sends Muse the photo first and then each piece, on the Standard model with its own tools off', () => {
    const body = tryOnBody({
      photo: picture(1, 'image/jpeg'),
      pieces: [
        { picture: picture(2, 'image/webp'), words: 'grey hoodie' },
        { picture: picture(3, 'image/webp'), words: 'navy jeans' },
      ],
      size: '1152x1536',
    })
    expect(body.model).toBe('muse-image-1.0')
    expect(body.size).toBe('1152x1536')
    expect(body.n).toBe(1)
    expect(body.tool_enablement).toEqual({ enable_image_search: false, enable_web_search: false, enable_shell: false })
    expect(body.images?.map(({ image_url }) => image_url)).toEqual([
      'data:image/jpeg;base64,AQ==',
      'data:image/webp;base64,Ag==',
      'data:image/webp;base64,Aw==',
    ])
    expect(body.prompt).toContain('- Image 2: grey hoodie\n- Image 3: navy jeans')
  })
})

describe('the try-on privacy rule', () => {
  it("lets out only the try-on's own account's photo", () => {
    expect(sendable({ accountId: 'ac_1' }, { accountId: 'ac_1' })).toBe(true)
    expect(sendable({ accountId: 'ac_2' }, { accountId: 'ac_1' })).toBe(false)
  })

  it('takes no try-on unless the person said the photo shows them', () => {
    const ask = {
      operationId: 'try-on-1',
      photoId: `ph_${'a'.repeat(22)}`,
      pieceIds: [`pc_${'c'.repeat(22)}`],
    }
    expect(Option.isSome(Schema.decodeUnknownOption(StartTryOn)({ ...ask, thisIsMe: true }))).toBe(true)
    expect(Option.isNone(Schema.decodeUnknownOption(StartTryOn)({ ...ask, thisIsMe: false }))).toBe(true)
    expect(Option.isNone(Schema.decodeUnknownOption(StartTryOn)(ask))).toBe(true)
  })

  it('wears at most nine pieces, so the photo and its pieces fit the ten pictures Muse takes', () => {
    const pieceIds = Array.from({ length: maximumTryOnPieces + 1 }, (_, at) => `pc_${String(at).padStart(22, 'p')}`)
    const ask = { operationId: 'try-on-1', photoId: `ph_${'a'.repeat(22)}`, thisIsMe: true }
    expect(Option.isNone(Schema.decodeUnknownOption(StartTryOn)({ ...ask, pieceIds }))).toBe(true)
    expect(Option.isSome(Schema.decodeUnknownOption(StartTryOn)({ ...ask, pieceIds: pieceIds.slice(1) }))).toBe(true)
    expect(Option.isNone(Schema.decodeUnknownOption(StartTryOn)({ ...ask, pieceIds: [] }))).toBe(true)
  })
})
