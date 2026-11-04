import { CurrentOperator, NotFound, type OperationId, PhotoCounts } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { storedAs, unavailable } from '../capture/Shared.ts'
import { once } from '../kernel/Receipts.ts'
import { PieceQueue } from '../wardrobe/Processing.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import type { PhotoServices } from './Finding.ts'
import { type GarmentRow, type PhotoRow, PhotoStore } from './Store.ts'

// The operator's side of My Gallery (Eva, 4 November): an account's photos in counts, and finding them again with the
// detector as it is now, paid by Styld (`Finding.ts` › refindGarments). The operator names the account by its email and
// is not an account; the re-find's receipt is the account's, so a repeat answers what it queued, and deleting the
// account deletes it. Counts only: never names, emails or pictures.

/** Photos sent to the piece queue at once. */
const sendAtOnce = 10

/** The account an email signs in to, or `NotFound`. */
const accountOf = (email: string) =>
  Effect.flatMap(
    storedAs(Effect.flatMap(PhotoStore, (store) => store.accountOf(email))),
    Option.match({
      onNone: () => Effect.fail(NotFound.make({})),
      onSome: ({ accountId }) => Effect.succeed(accountId),
    }),
  )

/** An account's photos, as counts. A garment added by hand whose piece was deleted is not counted, as it is not shown. */
const countsOf = (photos: ReadonlyArray<PhotoRow>, garments: ReadonlyArray<GarmentRow>, queued: number) => {
  const shown = garments.filter(({ cutoutKey, pieceId }) => cutoutKey !== null || pieceId !== null)
  const inState = (state: GarmentRow['state']) => shown.filter((garment) => garment.state === state).length
  const ready = photos.filter(({ status }) => status === 'ready')
  return {
    photos: photos.length,
    ready: ready.length,
    empty: ready.filter(({ id }) => !shown.some(({ photoId }) => photoId === id)).length,
    garments: shown.length,
    confirmed: inState('confirmed'),
    suggested: inState('suggested'),
    unmatched: inState('unmatched'),
    offered: inState('offered'),
    queued,
  } satisfies PhotoCounts
}

const photosOfAccount = Effect.fnUntraced(function* (accountId: string) {
  const store = yield* PhotoStore
  const photos = yield* storedAs(store.listPhotos(accountId))
  const garments = yield* storedAs(store.garmentsOf(photos.map(({ id }) => id)))
  return { photos, garments }
})

/** The operator's operations on an account's photos. */
export const refinding = Effect.map(Effect.context<PhotoServices | PieceQueue>(), (context) => ({
  /** An account's photos in counts, as the operator. */
  photoCounts: Effect.fn('Styld.Photos.counts')(function* (email: string) {
    yield* CurrentOperator
    const { photos, garments } = yield* photosOfAccount(yield* accountOf(email))
    return countsOf(photos, garments, 0)
  }, Effect.provide(context)),
  /** Find every ready photo of an account again, as the operator: each goes to the piece queue under this operation's
   * round, and the counts are answered as they stood when it was sent. */
  refindPhotos: Effect.fn('Styld.Photos.refindAll')(function* (email: string, operationId: OperationId) {
    yield* CurrentOperator
    const accountId = yield* accountOf(email)
    const run = Effect.gen(function* () {
      const { photos, garments } = yield* photosOfAccount(accountId)
      const ready = photos.filter(({ status }) => status === 'ready')
      const queue = yield* PieceQueue
      yield* Effect.forEach(
        ready,
        ({ id }) =>
          Effect.tryPromise({
            try: () => queue.send({ _tag: 'RefindGarments', photoId: id, round: operationId }),
            catch: unavailable,
          }),
        { concurrency: sendAtOnce, discard: true },
      )
      yield* Effect.annotateCurrentSpan({ 'styld.photo.refind': ready.length })
      const counts = countsOf(photos, garments, ready.length)
      return [counts, JSON.stringify(counts)] as const
    })
    const operation = { accountId, operationId, command: 'refindPhotos', input: email }
    return yield* once(yield* WardrobeStore, operation, {
      replay: (result) => Schema.decodeUnknownEffect(Schema.fromJsonString(PhotoCounts))(result).pipe(Effect.orDie),
      run,
    })
  }, Effect.provide(context)),
}))
