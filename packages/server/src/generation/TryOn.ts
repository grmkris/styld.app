import {
  type AddTryOnToBoard,
  CurrentAccount,
  NotFound,
  OperationId,
  type StartTryOn,
  TryOn,
  type TryOnId,
} from '@styld/protocol'
import { Array as Arr, Context, DateTime, Duration, Effect, Layer, Option, Predicate, Schema } from 'effect'
import { Boards } from '../boards/Boards.ts'
import { readObject } from '../capture/Shared.ts'
import { nowDate } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { deleteAfterRows, Media } from '../kernel/Media.ts'
import { Pacing } from '../kernel/Pacing.ts'
import { deleting, identify, priorResult, receiptRow } from '../kernel/Receipts.ts'
import { imageAddresses } from '../kernel/SignedMedia.ts'
import { receivedUpload } from '../mcp/ImageImport.ts'
import { PhotoStore } from '../photos/Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { stored, unavailable } from './Shared.ts'
import { drawingPatienceMillis, sendTryOn, tryOnHold, type TryOnServices } from './TryOnShared.ts'
import { TryOnStore, type TryOnRow } from './TryOnStore.ts'
import { admitTryOn, giveUpTryOn, workTryOn } from './TryOnWork.ts'
import { Holds } from '../usage/Holds.ts'

// Try on for the website (owner, 4 November 2026): a person picks one of their own My Gallery photos and pieces of
// their wardrobe, says the photo shows them, and Styld redraws it with them wearing the pieces. Every operation acts
// for `CurrentAccount`; the queue's work is `TryOnWork.ts`.

/** A try-on untouched this long lost its delivery: drawing one takes 90 s at most. */
const sweepPatience = Duration.minutes(5)
const sweepBatch = 50

const finished = (status: TryOnRow['status']) => status === 'done' || status === 'refused' || status === 'failed'

/** A try-on as its owner reads it, its result at their signed addresses, decoded against the protocol so a stored row
 * that drifted never leaves. */
const view = Effect.fnUntraced(function* (row: TryOnRow, pieceIds: ReadonlyArray<string>) {
  const images =
    row.status === 'done' && row.resultKey !== null
      ? yield* imageAddresses({
          entityId: row.id,
          key: row.resultKey,
          contentType: 'image/png',
          version: row.resultKey,
        })
      : Option.none()
  return yield* Schema.decodeUnknownEffect(TryOn)({
    id: row.id,
    photoId: row.photoId,
    pieceIds,
    status: row.status,
    ...Option.match(images, { onNone: () => ({}), onSome: (addresses) => ({ images: addresses }) }),
    createdAt: row.createdAt.toISOString(),
  }).pipe(Effect.mapError(unavailable))
})

/** The rows' views, each with the pieces it still wears. */
const views = Effect.fnUntraced(function* (rows: ReadonlyArray<TryOnRow>) {
  const pieces = yield* stored((yield* TryOnStore).piecesOf(rows.map(({ id }) => id)))
  return yield* Effect.forEach(rows, (row) =>
    view(
      row,
      pieces.filter(({ tryOnId }) => tryOnId === row.id).map(({ pieceId }) => pieceId),
    ),
  )
})

/** Send again every try-on among `rows` that stalled on its way: its message was lost or its delivery died. */
const nudge = Effect.fnUntraced(function* (rows: ReadonlyArray<TryOnRow>) {
  const at = yield* nowDate
  const stalled = rows.filter(
    ({ status, updatedAt }) => !finished(status) && at.getTime() - updatedAt.getTime() > drawingPatienceMillis,
  )
  yield* Effect.forEach(stalled, ({ id }) => sendTryOn(id).pipe(Effect.ignore), { discard: true })
})

/** A try-on of the account's; one stalled on its way is sent again. */
const get = Effect.fn('Styld.TryOn.get')(function* (tryOnId: string) {
  const { accountId } = yield* CurrentAccount
  yield* Effect.annotateCurrentSpan('styld.try_on_id', tryOnId)
  const row = yield* stored((yield* TryOnStore).findTryOn(accountId, tryOnId))
  if (Option.isNone(row)) return yield* NotFound.make({})
  yield* nudge([row.value])
  const [shown] = yield* views([row.value])
  return shown ?? (yield* unavailable())
})

/** The ready pieces of the account's among `pieceIds`, in the order asked, each once; NotFound when one is not there. */
const chosenPieces = Effect.fnUntraced(function* (accountId: string, pieceIds: ReadonlyArray<string>) {
  const chosen = Arr.dedupe(pieceIds)
  const found = yield* stored((yield* WardrobeStore).piecesWithIds(chosen))
  const ready = new Set(
    found.filter((piece) => piece.accountId === accountId && piece.status === 'ready').map(({ id }) => id),
  )
  if (!chosen.every((id) => ready.has(id))) return yield* NotFound.make({})
  return chosen
})

/** Finish an admission a lost request left behind, then put the try-on back on the queue. */
const resume = Effect.fnUntraced(function* (row: TryOnRow, operationId: string) {
  if (row.status === 'admitting') {
    yield* admitTryOn(row, operationId)
    yield* sendTryOn(row.id).pipe(Effect.ignore)
  }
  return yield* get(row.id).pipe(Effect.catchTag('NotFound', () => Effect.fail(unavailable())))
})

/** Start a try-on: the account's own photo and ready pieces, its credits held before anything runs. A repeat of the
 * operation answers the same try-on. */
const start = Effect.fn('Styld.TryOn.start')(function* (input: StartTryOn) {
  const { accountId } = yield* CurrentAccount
  const operation = yield* identify({
    accountId,
    operationId: input.operationId,
    command: 'tryOn',
    input: [input.photoId, input.pieceIds],
  })
  const store = yield* TryOnStore
  const earlier = yield* priorResult(operation, yield* stored(store.findReceipt(accountId, input.operationId)))
  if (Option.isSome(earlier)) {
    const row = yield* stored(store.findTryOn(accountId, earlier.value))
    if (Option.isNone(row)) return yield* unavailable()
    return yield* resume(row.value, input.operationId)
  }
  yield* (yield* Pacing).account('generate')
  const photo = yield* stored((yield* PhotoStore).findPhoto(accountId, input.photoId))
  if (Option.isNone(photo)) return yield* NotFound.make({})
  const pieceIds = yield* chosenPieces(accountId, input.pieceIds)
  const at = yield* nowDate
  const row: TryOnRow = {
    id: yield* newId('to'),
    accountId,
    photoId: photo.value.id,
    status: 'admitting',
    startedAt: null,
    resultKey: null,
    createdAt: at,
    updatedAt: at,
  }
  yield* Effect.annotateCurrentSpan('styld.try_on_id', row.id)
  yield* stored(store.insertTryOn(row, pieceIds, yield* receiptRow(operation, row.id)))
  yield* admitTryOn(row, input.operationId)
  yield* sendTryOn(row.id).pipe(Effect.ignore)
  return yield* get(row.id)
})

/** Delete a try-on and its result. One deleted before it ended gets its credits back: no delivery settles it now. */
const remove = Effect.fn('Styld.TryOn.delete')(function* (tryOnId: string, operationId: OperationId) {
  const { accountId } = yield* CurrentAccount
  const deletion = { accountId, operationId, command: 'deleteTryOn', target: tryOnId }
  const store = yield* TryOnStore
  yield* deleting(store, deletion, (receipt) =>
    Effect.gen(function* () {
      const deleted = yield* stored(store.deleteTryOn(accountId, tryOnId, receipt))
      if (Option.isNone(deleted)) return yield* NotFound.make({})
      if (!finished(deleted.value.status)) yield* (yield* Holds).settle(accountId, tryOnHold(tryOnId), 'failed')
      if (deleted.value.resultKey !== null)
        yield* deleteAfterRows((yield* Media).bucket, [deleted.value.resultKey], 'tryOn')
    }),
  )
})

/** A board's refusal as the try-on's: not found or a conflict stays so, anything else is unavailable. */
const onBoard = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) =>
      Predicate.isTagged(error, 'NotFound') || Predicate.isTagged(error, 'OperationConflict') ? error : unavailable(),
    ),
  )

/** Put a try-on's result on one of the person's boards, as a picture of its own, and answer the picture. The board
 * operation is keyed by the try-on and the board, so putting it on the same board again, whatever the request's id,
 * answers the same picture; one taken off the board since goes back under an id of the request's. The result is read
 * and uploaded only when the board does not hold it. */
const toBoard = Effect.fn('Styld.TryOn.toBoard')(function* (tryOnId: string, input: AddTryOnToBoard) {
  const { accountId } = yield* CurrentAccount
  const row = yield* stored((yield* TryOnStore).findTryOn(accountId, tryOnId))
  if (Option.isNone(row) || row.value.resultKey === null) return yield* NotFound.make({})
  const resultKey = row.value.resultKey
  const boards = yield* Boards
  const spot = yield* onBoard(
    boards.pictureSpot(input.boardId, [
      OperationId.make(`tb-${tryOnId}-${input.boardId}`.slice(0, 64)),
      OperationId.make(`tr-${input.operationId}`.slice(0, 64)),
    ]),
  )
  if (Predicate.isTagged(spot, 'Held')) return spot.image
  const bytes = yield* readObject(resultKey)
  if (Option.isNone(bytes)) return yield* unavailable()
  const uploadId = yield* receivedUpload(yield* Wardrobe, { contentType: 'image/png', bytes: bytes.value }).pipe(
    Effect.mapError(unavailable),
  )
  return yield* onBoard(boards.addGeneratedImage(input.boardId, { operationId: spot.operationId, uploadId }))
})

/** Every try-on operation over the services it yields (`TryOnShared.ts` `TryOnServices`). */
const make = Effect.gen(function* () {
  const context = yield* Effect.context<TryOnServices>()
  return {
    start: (input: StartTryOn) => start(input).pipe(Effect.provide(context)),
    get: (tryOnId: TryOnId) => get(tryOnId).pipe(Effect.provide(context)),
    list: Effect.fn('Styld.TryOn.list')(function* () {
      const { accountId } = yield* CurrentAccount
      const rows = yield* stored((yield* TryOnStore).listTryOns(accountId))
      // The website follows a try-on being made by reading the list, so the list sends a stalled one again too.
      yield* nudge(rows)
      return { tryOns: yield* views(rows) }
    }, Effect.provide(context)),
    delete: (tryOnId: TryOnId, operationId: OperationId) => remove(tryOnId, operationId).pipe(Effect.provide(context)),
    toBoard: (tryOnId: TryOnId, input: AddTryOnToBoard) => toBoard(tryOnId, input).pipe(Effect.provide(context)),
    /** Take a try-on further; the queue calls it for each delivery. */
    work: (tryOnId: string) => workTryOn(tryOnId).pipe(Effect.provide(context)),
    /** The queue's last try failed: the try-on fails and its credits go back. */
    giveUp: (tryOnId: string) => giveUpTryOn(tryOnId).pipe(Effect.provide(context)),
    /** The schedule's sweep: try-ons stalled past a drawing's patience go to the queue again, which settles them. */
    sweep: Effect.fn('Styld.TryOn.sweep')(function* () {
      const before = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, sweepPatience))
      const stalled = yield* stored((yield* TryOnStore).stalledTryOns(before, sweepBatch))
      yield* Effect.forEach(stalled, sendTryOn, { discard: true })
      return stalled.length
    }, Effect.provide(context)),
  }
})

/** Try-ons (owner, 4 November 2026), over the application's database, its generation queue, the person's photos and
 * wardrobe, and the image model. */
export class TryOns extends Context.Service<TryOns, Effect.Success<typeof make>>()('@styld/server/generation/TryOns') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => TryOns.of(service)),
  ).pipe(Layer.provide([TryOnStore.layer, PhotoStore.layer, WardrobeStore.layer]))
}
