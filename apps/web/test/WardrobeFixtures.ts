import { Piece } from '@styld/protocol'
import { Schema } from 'effect'

/** The signed address the API hands the website for a piece's picture (`kernel/SignedMedia.ts`), as a fixture. */
export const signedPicture = (pieceId: string, size: string, version = '0') =>
  `/cdn/media/${pieceId}/${size}?v=${version}&s=signature`

/** A piece as the API returns it to the website, with its pictures' signed addresses; the id is a valid opaque id
 * built from `seed`. */
export const pieceFixture = (seed: string, fields: Partial<Record<keyof typeof Piece.Type, unknown>> = {}) =>
  Schema.decodeUnknownSync(Piece)({
    id: `pc_${seed.padEnd(22, 'x')}`,
    images: {
      thumb: signedPicture(`pc_${seed.padEnd(22, 'x')}`, 'thumb'),
      full: signedPicture(`pc_${seed.padEnd(22, 'x')}`, 'full'),
    },
    name: null,
    notes: null,
    type: 'tops',
    colours: [],
    season: null,
    occasions: [],
    pattern: null,
    brand: null,
    shopUrl: null,
    hasBack: false,
    status: 'ready',
    source: 'website',
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    ...fields,
  })
