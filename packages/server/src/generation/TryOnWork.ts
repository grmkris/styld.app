import { prices } from '@styld/protocol'
import { Effect, Option, Predicate, Result } from 'effect'
import { PictureWork, type Picture } from '../capture/Providers.ts'
import { readObject, writeObject } from '../capture/Shared.ts'
import { nowDate } from '../kernel/Db.ts'
import { PhotoStore } from '../photos/Store.ts'
import { Holds } from '../usage/Holds.ts'
import { shownImage } from '../wardrobe/Shown.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { stored, unavailable } from './Shared.ts'
import { type TryOnRequest, TryOnPainter } from './TryOnPainter.ts'
import { tryOnSize, tryOnWords } from './TryOnPrompt.ts'
import {
  drawingPatienceMillis,
  sendable,
  settleTryOn,
  tryOnHold,
  tryOnKey,
  tryOnLifetimeMillis,
} from './TryOnShared.ts'
import { TryOnStore, type TryOnRow } from './TryOnStore.ts'

// Taking a try-on further, one delivery of the generation queue at a time: hold its credits, then draw it once. Every
// step reads where the try-on stands, so a redelivery picks up where the last one stopped.

/** Each piece's picture is sent at most this wide or tall. */
const pieceSide = 1024

/** A try-on stays non-runnable until its credits are held. A delivery that dies before promotion can resume
 * admission; a try-on that ended cannot be promoted again. */
export const admitTryOn = Effect.fn('Styld.TryOn.admission')(function* (row: TryOnRow, operationId?: string) {
  if (row.status !== 'admitting') return
  const store = yield* TryOnStore
  const at = yield* nowDate
  if (at.getTime() - row.createdAt.getTime() > tryOnLifetimeMillis) {
    if (yield* stored(store.advance(row.id, ['admitting'], { status: 'failed', updatedAt: at })))
      yield* settleTryOn({ ...row, status: 'failed' })
    return
  }
  yield* (yield* Holds).reserve({ accountId: row.accountId, hold: tryOnHold(row.id), credits: prices.tryOn }).pipe(
    Effect.andThen(stored(store.advance(row.id, ['admitting'], { status: 'drawing', updatedAt: at }))),
    Effect.tapError(() =>
      Effect.gen(function* () {
        const moved = yield* stored(
          store.advance(row.id, ['admitting'], { status: 'failed', updatedAt: yield* nowDate }),
        )
        if (!moved) return
        yield* settleTryOn({ ...row, status: 'failed' })
        if (operationId !== undefined) yield* stored(store.undoTryOn(row, operationId)).pipe(Effect.ignore)
      }),
    ),
    Effect.mapError((error) => (Predicate.isTagged(error, 'LimitReached') ? error : unavailable())),
  )
})

/** The account's pieces the try-on still wears, as the image model sees them: each one's shown picture (its drawing,
 * else its cut-out, turned as its owner turned it) at most `pieceSide` wide, with its words. */
const piecesOf = (row: TryOnRow) =>
  Effect.gen(function* () {
    const chosen = (yield* stored((yield* TryOnStore).piecesOf([row.id]))).map(({ pieceId }) => pieceId)
    const wardrobe = yield* WardrobeStore
    const pieces = new Map((yield* stored(wardrobe.listPieces(row.accountId))).map((piece) => [piece.id, piece]))
    const pictures = new Map(
      (yield* stored(wardrobe.picturesOf(row.accountId))).map((picture) => [picture.pieceId, picture]),
    )
    const work = yield* PictureWork
    return yield* Effect.forEach(
      chosen.flatMap((id) => Option.toArray(Option.fromNullishOr(pieces.get(id)))),
      (piece) =>
        Effect.gen(function* () {
          const shown = shownImage(piece, pictures.get(piece.id))
          const bytes = yield* readObject(shown.key)
          if (Option.isNone(bytes)) return Option.none()
          const webp = yield* work.thumbnail(bytes.value, pieceSide, shown.rotation).pipe(Effect.mapError(unavailable))
          const picture: Picture = { bytes: webp, contentType: 'image/webp' }
          return Option.some({ picture, words: tryOnWords(piece) })
        }),
      { concurrency: 3 },
    ).pipe(Effect.map((found) => found.flatMap(Option.toArray)))
  })

/** What the try-on is drawn from, or none when it has nothing left to draw: its photo gone, not the account's own, or
 * none of its pieces left. A provider or storage failure is `Unavailable`, for the queue to try again. */
const requestOf = (row: TryOnRow) =>
  Effect.gen(function* () {
    const photo = yield* stored((yield* PhotoStore).photoForWork(row.photoId))
    if (Option.isNone(photo) || !sendable(photo.value, row)) return Option.none<TryOnRequest>()
    const original = yield* readObject(photo.value.originalKey)
    if (Option.isNone(original)) return Option.none<TryOnRequest>()
    // Cloudflare Images re-encoded the photo when it was uploaded, so it carries no EXIF or location.
    const copies = yield* (yield* PictureWork).workingCopies(original.value).pipe(Effect.mapError(unavailable))
    const pieces = yield* piecesOf(row)
    if (pieces.length === 0) return Option.none<TryOnRequest>()
    return Option.some<TryOnRequest>({
      photo: { bytes: copies.jpeg, contentType: 'image/jpeg' },
      pieces,
      size: tryOnSize(copies),
    })
  })

/** End a drawing try-on: refused or lost (its credits go back), or done with its stored result. */
const finish = (row: TryOnRow, change: Pick<TryOnRow, 'status'> & Partial<Pick<TryOnRow, 'resultKey'>>) =>
  Effect.gen(function* () {
    yield* stored((yield* TryOnStore).advance(row.id, ['drawing'], { ...change, updatedAt: yield* nowDate }))
  })

/** Draw the try-on once and store its result. A refusal and an answer lost on the way both end it with its credits
 * back; a lost answer may have been drawn and billed, but the person did not get it, and it is never drawn again. */
const drawOnce = (row: TryOnRow, request: TryOnRequest) =>
  Effect.gen(function* () {
    const painted = yield* Effect.result((yield* TryOnPainter).tryOn(request))
    // Only a refusal Muse did not bill is 'refused'; a lost answer or a broken call is lost on the way.
    if (Result.isFailure(painted))
      return yield* finish(row, {
        status: Predicate.isTagged(painted.failure.reason, 'Refused') ? 'refused' : 'failed',
      })
    const key = tryOnKey(row)
    // The drawn bytes live only in this delivery: a result that cannot be stored now is lost.
    const kept = yield* Effect.result(writeObject(key, painted.success.bytes, painted.success.contentType))
    yield* finish(row, Result.isSuccess(kept) ? { status: 'done', resultKey: key } : { status: 'failed' })
  })

/** The drawing's turn: claimed and drawn when nobody has it, ended when the delivery that claimed it died, and left to
 * a delivery still drawing. The request is read before the claim, so a storage failure leaves it to be drawn again. */
const drawStep = (row: TryOnRow) =>
  Effect.gen(function* () {
    const at = yield* nowDate
    if (row.startedAt !== null) {
      if (at.getTime() - row.startedAt.getTime() > drawingPatienceMillis) yield* finish(row, { status: 'failed' })
      return
    }
    const request = yield* requestOf(row)
    if (Option.isNone(request)) return yield* finish(row, { status: 'failed' })
    if (yield* stored((yield* TryOnStore).claim(row.id, at))) yield* drawOnce(row, request.value)
  })

/** Give a try-on up: it fails and its credits go back. A drawing a live delivery claimed is left to finish. */
export const giveUpTryOn = Effect.fn('Styld.TryOn.giveUp')(function* (tryOnId: string) {
  const store = yield* TryOnStore
  const row = yield* stored(store.tryOnForWork(tryOnId))
  if (Option.isNone(row)) return
  const at = yield* nowDate
  const claimed = row.value.startedAt !== null && at.getTime() - row.value.startedAt.getTime() <= drawingPatienceMillis
  if (!claimed) yield* stored(store.advance(tryOnId, ['admitting', 'drawing'], { status: 'failed', updatedAt: at }))
  const latest = yield* stored(store.tryOnForWork(tryOnId))
  if (Option.isSome(latest)) yield* settleTryOn(latest.value)
})

/** Take the try-on as far as it goes now; one that ended has its credits settled, by this delivery or, if that settle
 * is lost, by the next. */
export const workTryOn = Effect.fn('Styld.TryOn.work')(function* (tryOnId: string) {
  const step = stored((yield* TryOnStore).tryOnForWork(tryOnId))
  const start = yield* step
  if (Option.isNone(start)) return
  yield* Effect.annotateCurrentSpan('styld.try_on_id', tryOnId)
  const now = yield* nowDate
  if (now.getTime() - start.value.createdAt.getTime() > tryOnLifetimeMillis) return yield* giveUpTryOn(tryOnId)
  if (start.value.status === 'admitting') yield* admitTryOn(start.value)
  const admitted = yield* step
  if (Option.isSome(admitted) && admitted.value.status === 'drawing') yield* drawStep(admitted.value)
  const last = yield* step
  if (Option.isSome(last)) yield* settleTryOn(last.value)
})
