import * as Domain from '@alchemy.run/domain'
import { describe, expect, it } from '@effect/vitest'
import { Styld } from '@styld/domain/Styld.model'
import {
  CurrentAccount,
  dailyCredits,
  OperationId,
  PhotoId,
  PieceId,
  prices,
  type StartTryOn,
  TryOnId,
} from '@styld/protocol'
import { Effect, Layer, Option, Ref } from 'effect'
import { Boards } from '../src/boards/Boards.ts'
import { PictureWork } from '../src/capture/Providers.ts'
import { GenerationQueue, type GenerationMessage } from '../src/generation/Queue.ts'
import { TryOns } from '../src/generation/TryOn.ts'
import { TryOnPainter, type TryOnRequest } from '../src/generation/TryOnPainter.ts'
import { TryOnStore } from '../src/generation/TryOnStore.ts'
import { Database } from '../src/kernel/Db.ts'
import { SignedMedia } from '../src/kernel/SignedMedia.ts'
import { outcomeUnknown, refused } from '../src/providers/Errors.ts'
import { Holds, holdId } from '../src/usage/Holds.ts'
import { Wardrobe } from '../src/wardrobe/Wardrobe.ts'
import { mediaOver } from './fakes/Bucket.ts'
import { unusedBoards } from './fakes/Boards.ts'
import { unlimited } from './fakes/Pacing.ts'
import { unusedWardrobe } from './fakes/Wardrobe.ts'
import { localD1 } from './LocalD1.ts'

// Try on over real SQLite and the real Wallet in memory: the credits it holds, the one drawing it makes, what it sends
// the image model, and whose photo it may send.

const photo = PhotoId.make(`ph_${'a'.repeat(22)}`)
const theirPhoto = PhotoId.make(`ph_${'b'.repeat(22)}`)
const top = PieceId.make(`pc_${'c'.repeat(22)}`)
const jeans = PieceId.make(`pc_${'d'.repeat(22)}`)
const theirShoes = PieceId.make(`pc_${'e'.repeat(22)}`)
const photoKey = 'accounts/ac_1/uploads/up_1'

type Behaviour = 'draw' | 'refuse' | 'lose'

const over = (behaviour: Behaviour) => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0), ('ac_2', 'r', 'Bo', 0);
    INSERT INTO uploads (id, account_id, token_digest, content_type, bytes, object_key, status, expires_at)
      VALUES ('up_1', 'ac_1', 'd1', 'image/jpeg', 3, '${photoKey}', 'used', 0),
             ('up_2', 'ac_2', 'd2', 'image/jpeg', 3, 'accounts/ac_2/uploads/up_2', 'used', 0);
    INSERT INTO outfit_photos (id, account_id, upload_id, original_key, content_type, status, favourite, created_at, updated_at)
      VALUES ('${photo}', 'ac_1', 'up_1', '${photoKey}', 'image/jpeg', 'ready', 0, 0, 0),
             ('${theirPhoto}', 'ac_2', 'up_2', 'accounts/ac_2/uploads/up_2', 'image/jpeg', 'ready', 0, 0, 0);
    INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, content_type, created_at, updated_at)
      VALUES ('${top}', 'ac_1', 'shortSleeveTops', '["white"]', '[]', 'ready', 'website', 'k-top', 'image/png', 0, 0),
             ('${jeans}', 'ac_1', 'jeans', '["navy"]', '[]', 'ready', 'website', 'k-jeans', 'image/png', 0, 0),
             ('${theirShoes}', 'ac_2', 'trainers', '["white"]', '[]', 'ready', 'website', 'k-shoes', 'image/png', 0, 0);
  `)
  const objects = new Map<string, Uint8Array>([
    [photoKey, new Uint8Array([1, 1, 1])],
    ['k-top', new Uint8Array([2])],
    ['k-jeans', new Uint8Array([3])],
  ])
  const sent: Array<GenerationMessage> = []
  const asked = Effect.runSync(Ref.make<ReadonlyArray<TryOnRequest>>([]))
  const painter = TryOnPainter.of({
    tryOn: (request) =>
      Effect.gen(function* () {
        yield* Ref.update(asked, (requests) => [...requests, request])
        if (behaviour === 'refuse') return yield* refused('meta-muse')
        if (behaviour === 'lose') return yield* outcomeUnknown('meta-muse')
        return { bytes: new Uint8Array([9, 9]), contentType: 'image/png' as const }
      }),
  })
  const work = PictureWork.of({
    workingCopies: (original) =>
      Effect.succeed({ width: 768, height: 1024, png: original, jpeg: original, small: original }),
    thumbnail: (image) => Effect.succeed(image),
    foreground: () => Effect.die('not used by these tests'),
    jpeg: () => Effect.die('not used by these tests'),
  })
  const signed = SignedMedia.of({
    address: (grant) => Effect.succeed(Option.some(`/cdn/media/${grant.entityId}/${grant.variant}`)),
    verify: () => Effect.succeed(Option.none()),
  })
  const db = Database.layer(database)
  const wallet = Styld.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory))
  const holds = Holds.layer.pipe(Layer.provide(Layer.merge(wallet, db)))
  const services = Layer.mergeAll(
    holds,
    unlimited,
    mediaOver(objects),
    GenerationQueue.layer({ send: async (message) => void sent.push(message) }),
    Layer.succeed(TryOnPainter, painter),
    Layer.succeed(PictureWork, work),
    Layer.succeed(SignedMedia, signed),
    Layer.succeed(Wardrobe, Wardrobe.of(unusedWardrobe)),
    Layer.succeed(Boards, Boards.of(unusedBoards)),
    db,
  )
  const layer = Layer.mergeAll(
    TryOns.layer.pipe(Layer.provide(services)),
    TryOnStore.layer.pipe(Layer.provide(db)),
    holds,
    Layer.succeed(CurrentAccount, { accountId: 'ac_1', via: 'session' as const }),
  )
  return { layer, objects, sent, asked }
}

const ask = (pieceIds: ReadonlyArray<PieceId>, operation = 'try-on-1', on = photo): StartTryOn => ({
  operationId: OperationId.make(operation),
  photoId: on,
  pieceIds,
  thisIsMe: true,
})

describe('a try-on', () => {
  it.effect(
    'holds its credits, draws once from the photo and the pieces, and spends them when the result is kept',
    () => {
      const { layer, objects, sent, asked } = over('draw')
      return Effect.gen(function* () {
        const tryOns = yield* TryOns
        const started = yield* tryOns.start(ask([top, jeans]))
        expect(started.status).toBe('drawing')
        expect(yield* (yield* Holds).remaining('ac_1')).toBe(dailyCredits - prices.tryOn)
        expect(sent).toEqual([{ _tag: 'TakeTryOn', tryOnId: started.id }])

        yield* tryOns.work(started.id)
        yield* tryOns.work(started.id)
        const [request, ...again] = yield* Ref.get(asked)
        expect(again).toEqual([])
        expect(request?.photo.bytes).toEqual(new Uint8Array([1, 1, 1]))
        expect(request?.pieces.map(({ words }) => words)).toEqual(['white t-shirt', 'navy jeans'])
        expect(request?.size).toBe('1152x1536')

        const done = yield* tryOns.get(started.id)
        expect(done.status).toBe('done')
        expect(done.pieceIds).toEqual([top, jeans])
        expect(done.images?.full).toBe(`/cdn/media/${started.id}/full`)
        expect(objects.get(`accounts/ac_1/photos/${photo}/try-ons/${started.id}.png`)).toEqual(new Uint8Array([9, 9]))
        expect(yield* (yield* Holds).remaining('ac_1')).toBe(dailyCredits - prices.tryOn)
      }).pipe(Effect.provide(layer))
    },
  )

  it.effect('gives the credits back when Muse refuses it', () => {
    const { layer } = over('refuse')
    return Effect.gen(function* () {
      const tryOns = yield* TryOns
      const started = yield* tryOns.start(ask([top]))
      yield* tryOns.work(started.id)
      expect((yield* tryOns.get(started.id)).status).toBe('refused')
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(dailyCredits)
    }).pipe(Effect.provide(layer))
  })

  it.effect('gives the credits back when the answer is lost, and never draws it again', () => {
    const { layer, asked } = over('lose')
    return Effect.gen(function* () {
      const tryOns = yield* TryOns
      const started = yield* tryOns.start(ask([top]))
      yield* tryOns.work(started.id)
      yield* tryOns.work(started.id)
      expect((yield* tryOns.get(started.id)).status).toBe('failed')
      expect((yield* Ref.get(asked)).length).toBe(1)
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(dailyCredits)
    }).pipe(Effect.provide(layer))
  })

  it.effect('answers a repeat from its receipt and refuses another try-on under the same id', () => {
    const { layer } = over('draw')
    return Effect.gen(function* () {
      const tryOns = yield* TryOns
      const first = yield* tryOns.start(ask([top]))
      const repeat = yield* tryOns.start(ask([top]))
      expect(repeat.id).toBe(first.id)
      expect(yield* Effect.flip(tryOns.start(ask([jeans])))).toMatchObject({ _tag: 'OperationConflict' })
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(dailyCredits - prices.tryOn)
    }).pipe(Effect.provide(layer))
  })

  it.effect("never sends another account's photo, nor wears another account's pieces", () => {
    const { layer, asked } = over('draw')
    return Effect.gen(function* () {
      const tryOns = yield* TryOns
      expect(yield* Effect.flip(tryOns.start(ask([top], 'try-on-2', theirPhoto)))).toMatchObject({ _tag: 'NotFound' })
      expect(yield* Effect.flip(tryOns.start(ask([top, theirShoes], 'try-on-3')))).toMatchObject({ _tag: 'NotFound' })
      expect((yield* tryOns.list()).tryOns).toEqual([])
      expect(yield* Ref.get(asked)).toEqual([])
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(dailyCredits)
    }).pipe(Effect.provide(layer))
  })

  it.effect('past the day’s credits is undone, so its operation id can be used again', () => {
    const { layer } = over('draw')
    return Effect.gen(function* () {
      const holds = yield* Holds
      yield* holds.reserve({ accountId: 'ac_1', hold: holdId('photo', 'ph_other', 0), credits: dailyCredits - 1 })
      const tryOns = yield* TryOns
      expect(yield* Effect.flip(tryOns.start(ask([top])))).toMatchObject({ _tag: 'LimitReached' })
      expect((yield* tryOns.list()).tryOns).toEqual([])
      expect(Option.isNone(yield* (yield* TryOnStore).findReceipt('ac_1', 'try-on-1'))).toBe(true)
      expect(yield* holds.remaining('ac_1')).toBe(1)
    }).pipe(Effect.provide(layer))
  })

  it.effect('is deleted with its result, and one deleted before it ended gets its credits back', () => {
    const { layer, objects } = over('draw')
    return Effect.gen(function* () {
      const tryOns = yield* TryOns
      const drawn = yield* tryOns.start(ask([top]))
      yield* tryOns.work(drawn.id)
      const waiting = yield* tryOns.start(ask([jeans], 'try-on-2'))
      yield* tryOns.delete(drawn.id, OperationId.make('delete-1'))
      yield* tryOns.delete(waiting.id, OperationId.make('delete-2'))
      yield* tryOns.delete(waiting.id, OperationId.make('delete-2'))
      expect((yield* tryOns.list()).tryOns).toEqual([])
      expect([...objects.keys()].some((key) => key.includes('try-ons'))).toBe(false)
      expect(yield* Effect.flip(tryOns.get(TryOnId.make(drawn.id)))).toMatchObject({ _tag: 'NotFound' })
      expect(yield* (yield* Holds).remaining('ac_1')).toBe(dailyCredits - prices.tryOn)
    }).pipe(Effect.provide(layer))
  })
})
