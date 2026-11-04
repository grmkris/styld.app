import { turned } from '@styld/imaging'
import { CurrentAccount } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { describe, expect, test } from 'vitest'
import { type MediaGrant, SignedMedia } from '../src/kernel/SignedMedia.ts'
import { pieceImages } from '../src/wardrobe/Images.ts'
import type { PictureRow, PieceRow } from '../src/wardrobe/Store.ts'
import type { BackPictureRow } from '../src/capture/BackPictureStore.ts'

// The signed addresses of a piece's pictures, and the quarter turn each is delivered with: the owner's rotation turns
// their own photo and cut-out, and the drawing by what it is past the rotation it was drawn at; never the back (a
// photo of its own). A rotation applied twice, by the address and again on the page, once made "Rotate image" never
// stick (Eva's skirt, 4 November); a drawing that never turned once made it useless on the shop-style picture (Eva's
// top, 4 November).

const at = new Date(0)

/** A ready cut-out turned a half turn by its owner, with a back. */
const piece: PieceRow = {
  id: 'pc_1',
  accountId: 'ac_1',
  name: null,
  notes: null,
  type: 'skirts',
  colours: ['black'],
  seasons: [],
  rainproof: false,
  category: null,
  occasions: [],
  pattern: null,
  brand: null,
  shopUrl: null,
  status: 'ready',
  source: 'website',
  uploadId: null,
  detectionId: null,
  backImageKey: 'accounts/ac_1/pieces/pc_1/back.png',
  rotation: 180,
  originalKey: 'accounts/ac_1/uploads/photo.jpg',
  imageKey: 'accounts/ac_1/pieces/pc_1/image.png',
  contentType: 'image/jpeg',
  createdAt: at,
  updatedAt: at,
}

/** The front's drawing, drawn at `drawnRotation` (by default the piece's, so upright). */
const drawn = (shown: PictureRow['shown'], drawnRotation: PictureRow['drawnRotation'] = 180): PictureRow => ({
  pieceId: 'pc_1',
  accountId: 'ac_1',
  state: 'ready',
  shown,
  cleanKey: 'accounts/ac_1/pieces/pc_1/clean-1.png',
  version: 1,
  drawnRotation,
  keyColour: 'green',
  provider: 'meta-muse',
  face: 0.01,
  hint: null,
  redraws: 0,
  paid: false,
  claimedAt: at,
  createdAt: at,
  updatedAt: at,
})

/** The back's pressed drawing, in `state`. */
const backDrawn = (state: BackPictureRow['state']): BackPictureRow => ({
  pieceId: 'pc_1',
  accountId: 'ac_1',
  state,
  sourceKey: 'accounts/ac_1/pieces/pc_1/back.png',
  cleanKey: 'accounts/ac_1/pieces/pc_1/back-clean-1.png',
  version: 1,
  keyColour: 'green',
  provider: 'meta-muse',
  face: 0.01,
  claimedAt: at,
  createdAt: at,
  updatedAt: at,
})

/** The grants the page's addresses were signed for, by stored key. */
const grantsOf = (picture: PictureRow, back?: BackPictureRow) => {
  const grants = new Map<string, Omit<MediaGrant, 'accountId'>>()
  const signed = SignedMedia.of({
    address: (grant) =>
      Effect.sync(() => {
        grants.set(grant.key, grant)
        return Option.some(`/cdn/media/${grant.entityId}/${grant.variant}`)
      }),
    verify: () => Effect.succeed(Option.none()),
  })
  Effect.runSync(
    pieceImages(piece, { picture, back }, true).pipe(
      Effect.provideService(SignedMedia, signed),
      Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'ac_1', via: 'session' })),
    ),
  )
  return grants
}

describe('the turn a piece’s pictures are delivered with', () => {
  test('a drawing made before the piece was turned turns with it, by what the rotation is past the one it was drawn at', () => {
    const grants = grantsOf(drawn('clean', 0))
    expect(grants.get('accounts/ac_1/pieces/pc_1/clean-1.png')?.rotation).toBe(180)
    expect(grantsOf(drawn('clean', 90)).get('accounts/ac_1/pieces/pc_1/clean-1.png')?.rotation).toBe(90)
    expect(grantsOf(drawn('clean', 270)).get('accounts/ac_1/pieces/pc_1/clean-1.png')?.rotation).toBe(270)
    expect(grants.get('accounts/ac_1/pieces/pc_1/back.png')?.rotation).toBe(0)
  })

  test('a drawing made at the piece’s rotation and the back come upright; the photo and cut-out turned by it', () => {
    const grants = grantsOf(drawn('clean'))
    expect(grants.get('accounts/ac_1/pieces/pc_1/clean-1.png')?.rotation).toBe(0)
    expect(grants.get('accounts/ac_1/pieces/pc_1/back.png')?.rotation).toBe(0)
    expect(grants.get('accounts/ac_1/pieces/pc_1/image.png')?.rotation).toBe(180)
    expect(grants.get('accounts/ac_1/uploads/photo.jpg')?.rotation).toBe(180)
  })

  test('the back’s drawing comes upright on the page once it passed its check, and not before', () => {
    expect(
      grantsOf(drawn('clean'), backDrawn('ready')).get('accounts/ac_1/pieces/pc_1/back-clean-1.png'),
    ).toMatchObject({
      rotation: 0,
      contentType: 'image/png',
    })
    expect(grantsOf(drawn('clean'), backDrawn('checking')).has('accounts/ac_1/pieces/pc_1/back-clean-1.png')).toBe(
      false,
    )
  })

  test('the cut-out the piece shows instead of its drawing keeps the owner’s rotation', () => {
    expect(grantsOf(drawn('photo')).get('accounts/ac_1/pieces/pc_1/image.png')?.rotation).toBe(180)
  })
})

/** A 2×1 picture: a red pixel left of a blue one. */
const pair = { width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]) }
const pixels = (picture: { readonly data: Uint8Array }) => [...picture.data]

describe('the cut-out the drawing step sees', () => {
  test('is turned clockwise by the owner’s rotation, as the Images binding turns what the owner sees', () => {
    expect(turned(pair, 0)).toBe(pair)
    expect(turned(pair, 90)).toMatchObject({ width: 1, height: 2 })
    // A quarter turn clockwise puts the left pixel on top.
    expect(pixels(turned(pair, 90))).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
    expect(pixels(turned(pair, 180))).toEqual([0, 0, 255, 255, 255, 0, 0, 255])
    expect(pixels(turned(pair, 270))).toEqual([0, 0, 255, 255, 255, 0, 0, 255])
    expect(pixels(turned(turned(pair, 90), 270))).toEqual(pixels(pair))
  })
})
