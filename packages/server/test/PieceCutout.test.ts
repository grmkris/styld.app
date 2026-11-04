import { describe, expect, it } from '@effect/vitest'
import { encodePng } from '@styld/imaging'
import { CurrentAccount } from '@styld/protocol'
import { Effect, Layer, Option, Record } from 'effect'
import { Garments } from '../src/capture/Garments.ts'
import { pieceCutout } from '../src/capture/PieceCutout.ts'
import { GarmentVision } from '../src/capture/Providers.ts'
import { mediaOver } from './fakes/Bucket.ts'
import { Pacing, paces } from '../src/kernel/Pacing.ts'
import { cutOutPerson } from '../src/photos/Cutout.ts'
import { type PhotoRow, PhotoStore } from '../src/photos/Store.ts'
import { Holds } from '../src/usage/Holds.ts'
import { PaidAttempts } from '../src/usage/Attempts.ts'
import { Database } from '../src/kernel/Db.ts'
import { localD1 } from './LocalD1.ts'
import { GarmentCutout } from '../src/wardrobe/Processing.ts'
import { importedDetails } from '../src/wardrobe/Work.ts'

// Cut-outs SAM bills for. A piece's own: the account pays a photo's credit for its own piece, Styld pays for a piece
// imported from v1 and for a back, and a stored cut-out is described by the decision model (an import's attributes). A gallery
// photo's person: free to the person, so asked once per photo, whether a person was found or not, at the account's
// pace.

/** A provider call a cut-out never makes. */
const unused = () => Effect.die(new Error('not called by a cut-out'))

const cut = encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(200) })

/** The cut-out services over a bucket holding `photo.jpg`: SAM answers `found`, and the account may go on `allowed`
 * times a minute. */
const over = (found: Option.Option<Uint8Array> = Option.some(cut), allowed = 10) => {
  const held: Array<string> = []
  const asked = { sam: 0, paces: 0 }
  const stored = new Map<string, Uint8Array>([['photo.jpg', new Uint8Array([0xff, 0xd8, 0xff])]])
  const limiter = {
    limit: async () => {
      asked.paces += 1
      return { success: asked.paces <= allowed }
    },
  }
  const services = Layer.mergeAll(
    mediaOver(stored),
    Layer.succeed(
      Garments,
      Garments.of({
        find: unused,
        cut: () => Effect.sync(() => ((asked.sam += 1), found)),
        forget: () => Effect.void,
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
            seasons: ['autumn', 'winter'],
            rainproof: false,
            occasions: ['casual'],
            pattern: 'plain',
            whole: 0.9,
          }),
        checkHeld: unused,
        judge: unused,
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
    Pacing.layer(Record.map(paces, () => limiter)),
  )
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
      VALUES ('up_1', 'ac_1', 'd', 'image/jpeg', 3, 'photo.jpg', 'used', 0);
    INSERT INTO outfit_photos (id, account_id, upload_id, original_key, content_type, status, favourite, created_at,
      updated_at)
      VALUES ('ph_1', 'ac_1', 'up_1', 'photo.jpg', 'image/jpeg', 'ready', 0, 0, 0);
  `)
  const kernel = Layer.merge(services, Database.layer(database))
  const attempts = PaidAttempts.layer.pipe(Layer.provide(kernel))
  return {
    held,
    asked,
    stored,
    layer: pieceCutout.pipe(Layer.provide(Layer.merge(services, attempts))),
    gallery: Layer.mergeAll(PhotoStore.layer, attempts).pipe(Layer.provideMerge(kernel)),
  }
}

const input = (payer: 'account' | 'styld') => ({
  accountId: 'ac_1',
  pieceId: 'pc_1',
  originalKey: 'photo.jpg',
  contentType: 'image/jpeg',
  type: 'shortSleeveTops' as const,
  of: { side: 'front' as const, payer },
})

describe("a piece's cut-out", () => {
  it.effect("costs the account a photo's credit for its own piece, and nothing of its credits for an import", () => {
    const { held, layer } = over()
    return Effect.gen(function* () {
      const cutout = yield* GarmentCutout
      expect(yield* cutout.cut(input('account'))).toEqual({ imageKey: 'accounts/ac_1/pieces/pc_1/cutout.png' })
      expect(held).toEqual(['reserve piece/pc_1/1', 'succeeded piece/pc_1/1'])
      // Asked again (a redelivery), the stored cut-out answers: nothing is cut or held again.
      held.length = 0
      expect(yield* cutout.cut(input('account'))).toEqual({ imageKey: 'accounts/ac_1/pieces/pc_1/cutout.png' })
      expect(held).toEqual(['succeeded piece/pc_1/1'])
      held.length = 0
      expect(yield* cutout.cut({ ...input('styld'), pieceId: 'pc_2' })).toEqual({
        imageKey: 'accounts/ac_1/pieces/pc_2/cutout.png',
      })
      expect(held).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect("holds none of the account's credits for a back added on the piece's page (owner, 4 November)", () => {
    const { held, layer } = over()
    return Effect.gen(function* () {
      const cutout = yield* GarmentCutout
      expect(yield* cutout.cut({ ...input('account'), of: { side: 'back', uploadId: 'up_1' } })).toEqual({
        imageKey: 'accounts/ac_1/pieces/pc_1/back-up_1.png',
      })
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
          seasons: ['autumn', 'winter'],
          rainproof: false,
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
    seasons: [],
    rainproof: true,
    occasions: ['casual' as const],
    pattern: undefined,
    whole: 0.9,
  }
  it('of a house garment the seed generated keep the type it was generated as, however sure the model is', () => {
    expect(importedDetails({ type: 'trousers', colours: ['black'] }, { ...described, confidence: 0.99 }, true)).toEqual(
      {
        seasons: [],
        rainproof: true,
        occasions: ['casual'],
        pattern: null,
      },
    )
  })
  it("take the model's type within the mapped group, or when it is sure; v1's colours stay unless there were none", () => {
    expect(importedDetails({ type: 'trousers', colours: ['black'] }, described)).toEqual({
      type: 'jeans',
      seasons: [],
      rainproof: true,
      occasions: ['casual'],
      pattern: null,
    })
    expect(importedDetails({ type: 'trainers', colours: [] }, described)).toEqual({
      colours: ['blue'],
      seasons: [],
      rainproof: true,
      occasions: ['casual'],
      pattern: null,
    })
    expect(importedDetails({ type: 'trainers', colours: [] }, { ...described, confidence: 0.9 })).toMatchObject({
      type: 'jeans',
    })
  })
})

const photo: PhotoRow = {
  id: 'ph_1',
  accountId: 'ac_1',
  uploadId: 'up_1',
  originalKey: 'photo.jpg',
  contentType: 'image/jpeg',
  status: 'ready',
  favourite: false,
  lookId: null,
  cutoutKey: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const asOwner = Effect.provideService(CurrentAccount, { accountId: 'ac_1', via: 'session' })

describe("a gallery photo's person cut-out", () => {
  it.effect('asks SAM once for a photo with nobody in it, and answers again from that outcome', () => {
    const { asked, gallery } = over(Option.none())
    return Effect.gen(function* () {
      const first = yield* Effect.flip(cutOutPerson(photo))
      const again = yield* Effect.flip(cutOutPerson(photo))
      expect([first, again]).toMatchObject([{ _tag: 'NoPersonFound' }, { _tag: 'NoPersonFound' }])
      expect(asked.sam).toBe(1)
    }).pipe(asOwner, Effect.provide(gallery))
  })

  it.effect('keeps a person found with the photo', () => {
    const { asked, gallery, stored } = over()
    return Effect.gen(function* () {
      yield* cutOutPerson(photo)
      const kept = yield* (yield* PhotoStore).photoForWork('ph_1')
      const key = 'accounts/ac_1/photos/ph_1/cutout.png'
      expect(Option.map(kept, ({ cutoutKey }) => cutoutKey)).toEqual(Option.some(key))
      expect([stored.has(key), asked.sam]).toEqual([true, 1])
    }).pipe(asOwner, Effect.provide(gallery))
  })

  it.effect("asks no faster than the account's pace", () => {
    const { asked, gallery } = over(Option.none(), 0)
    return Effect.gen(function* () {
      expect(yield* Effect.flip(cutOutPerson(photo))).toMatchObject({ _tag: 'SlowDown' })
      expect(asked.sam).toBe(0)
    }).pipe(asOwner, Effect.provide(gallery))
  })
})
