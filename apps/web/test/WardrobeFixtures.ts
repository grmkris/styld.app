import { Piece } from '@styld/protocol'
import { Schema } from 'effect'

/** A piece as the API returns it; the id is a valid opaque id built from `seed`. */
export const pieceFixture = (seed: string, fields: Partial<Record<keyof typeof Piece.Type, unknown>> = {}) =>
  Schema.decodeUnknownSync(Piece)({
    id: `pc_${seed.padEnd(22, 'x')}`,
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
