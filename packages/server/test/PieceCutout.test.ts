import { describe, expect, it } from '@effect/vitest'
import { encodePng } from '@styld/imaging'
import { Effect, Layer, Option } from 'effect'
import { Garments } from '../src/capture/Garments.ts'
import { pieceCutout } from '../src/capture/PieceCutout.ts'
import { GarmentVision } from '../src/capture/Providers.ts'
import { Media } from '../src/kernel/Media.ts'
import { Holds } from '../src/usage/Holds.ts'
import { GarmentCutout } from '../src/wardrobe/Processing.ts'
import { importedDetails } from '../src/wardrobe/Work.ts'

// A piece's own cut-out: the account pays a photo's credit for its own piece, Styld pays for a piece imported from v1,
// and a stored cut-out is described by the decision model (an import's attributes).

/** A provider call a piece's own cut-out never makes. */
const unused = () => Effect.die(new Error('not called by a piece cut-out'))

const cut = encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(200) })

const over = () => {
  const held: Array<string> = []
  const stored = new Map<string, Uint8Array>([['photo.jpg', new Uint8Array([0xff, 0xd8, 0xff])]])
  const bucket = {
    get: async (key: string) => {
      const bytes = stored.get(key)
      return bytes === undefined ? null : { arrayBuffer: async () => bytes.slice().buffer }
    },
    put: async (key: string, bytes: Uint8Array) => void stored.set(key, bytes),
  }
  const services = Layer.mergeAll(
    // SAFETY: the fake implements the bucket get and put a piece's cut-out calls -- the rest of R2 and Images is never called here
    Layer.succeed(Media, Media.of({ bucket, images: {} } as never)),
    Layer.succeed(
      Garments,
      Garments.of({
        find: unused,
        cut: () => Effect.succeed(Option.some(cut)),
        handOver: unused,
        track: unused,
      }),
    ),
    Layer.succeed(
      GarmentVision,
      GarmentVision.of({
        route: unused,
        suggest: () =>
          Effect.succeed({
            type: 'knitwear',
            confidence: 0.9,
            colours: ['beige'],
            season: 'cold',
            occasions: ['casual'],
            pattern: 'plain',
            whole: 0.9,
          }),
        checkHeld: unused,
        judge: unused,
        compare: unused,
        sameGarment: unused,
        compareTurn: unused,
      }),
    ),
    Layer.succeed(
      Holds,
      Holds.of({
        reserve: (charge) => Effect.sync(() => void held.push(`reserve ${charge.hold}`)),
        settle: (_accountId, hold, ending) => Effect.sync(() => void held.push(`${ending} ${hold}`)),
        remaining: () => Effect.succeed(10),
        sweep: Effect.succeed(0),
      }),
    ),
  )
  return { held, layer: pieceCutout.pipe(Layer.provide(services)) }
}

const input = (payer: 'account' | 'styld') => ({
  accountId: 'ac_1',
  pieceId: 'pc_1',
  originalKey: 'photo.jpg',
  contentType: 'image/jpeg',
  type: 'tops' as const,
  of: { side: 'front' as const, attempt: 1, payer },
})

describe("a piece's cut-out", () => {
  it.effect("costs the account a photo's credit for its own piece, and nothing of its credits for an import", () => {
    const { held, layer } = over()
    return Effect.gen(function* () {
      const cutout = yield* GarmentCutout
      expect(yield* cutout.cut(input('account'))).toEqual({ imageKey: 'accounts/ac_1/pieces/pc_1/cutout.png' })
      expect(held).toEqual(['reserve piece/pc_1/1', 'succeeded piece/pc_1/1'])
      held.length = 0
      expect(yield* cutout.cut(input('styld'))).toEqual({ imageKey: 'accounts/ac_1/pieces/pc_1/cutout.png' })
      expect(held).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('is described by the decision model once stored, and a missing one is not', () => {
    const { layer } = over()
    return Effect.gen(function* () {
      const cutout = yield* GarmentCutout
      const { imageKey } = yield* cutout.cut(input('styld'))
      expect(yield* cutout.describe(imageKey)).toEqual(
        Option.some({
          type: 'knitwear',
          confidence: 0.9,
          colours: ['beige'],
          season: 'cold',
          occasions: ['casual'],
          pattern: 'plain',
          whole: 0.9,
        }),
      )
      expect(yield* cutout.describe('accounts/ac_1/pieces/pc_1/missing.png')).toEqual(Option.none())
    }).pipe(Effect.provide(layer))
  })
})

describe("an imported piece's details", () => {
  const described = {
    type: 'jeans' as const,
    confidence: 0.5,
    colours: ['blue' as const],
    season: 'allYear' as const,
    occasions: ['casual' as const],
    pattern: undefined,
  }
  it("take the model's type within the mapped group, or when it is sure; v1's colours stay unless there were none", () => {
    expect(importedDetails({ type: 'trousers', colours: ['black'] }, described)).toEqual({
      type: 'jeans',
      season: 'allYear',
      occasions: ['casual'],
      pattern: null,
    })
    expect(importedDetails({ type: 'trainers', colours: [] }, described)).toEqual({
      colours: ['blue'],
      season: 'allYear',
      occasions: ['casual'],
      pattern: null,
    })
    expect(importedDetails({ type: 'trainers', colours: [] }, { ...described, confidence: 0.9 })).toMatchObject({
      type: 'jeans',
    })
  })
})
