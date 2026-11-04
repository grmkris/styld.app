import { CurrentAccount, NotFound, type OperationId, type PieceId, type SetBack } from '@styld/protocol'
import { Effect, Option, Predicate } from 'effect'
import {
  forgetObjects,
  ownerPiece,
  ownPiece,
  stored,
  typeOf,
  unavailable,
  usableUpload,
  type WardrobeServices,
} from './Shared.ts'
import { GarmentCutout, PieceQueue } from './Processing.ts'
import { WardrobeStore } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { identify, priorResult, receiptRow } from '../kernel/Receipts.ts'

/** Ask the back picture job to bring the piece's back picture in line with its back (owner, 4 November: a pressed back
 * drawn from the real one): drawn, drawn again or forgotten. The back stands whether or not the queue takes it now; a
 * repeat of the operation asks again, and the operator's backfill finds any left behind. */
const backPicture = (accountId: string, pieceId: string) =>
  Effect.flatMap(PieceQueue, (queue) =>
    Effect.tryPromise({ try: () => queue.send({ _tag: 'DrawBackPicture', accountId, pieceId }), catch: unavailable }),
  ).pipe(Effect.ignore({ log: true, message: 'Styld.Wardrobe.backPicture could not reach the queue' }))

/** A back of the piece: the person's photo of it, cut out like the front (owner, 2026-10-31), free since 4 November.
 * Repeating the operation answers the piece again; a cut-out that could not be made keeps the photo. */
export const backing = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  setBack: Effect.fn('Styld.Wardrobe.setBack')(function* (pieceId: PieceId, input: SetBack) {
    const { accountId } = yield* CurrentAccount
    const store = yield* WardrobeStore
    const piece = yield* ownPiece(pieceId)
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'setBack',
      input: [pieceId, input.uploadId],
    })
    const prior = yield* priorResult(operation, yield* stored(store.findReceipt(accountId, input.operationId)))
    if (Option.isSome(prior)) {
      yield* backPicture(accountId, pieceId)
      return yield* ownerPiece(accountId, piece)
    }
    const upload = yield* usableUpload(accountId, input.uploadId)
    const of = { side: 'back' as const, uploadId: upload.id }
    const type = yield* typeOf(piece)
    const { imageKey } = yield* (yield* GarmentCutout)
      .cut({ accountId, pieceId, originalKey: upload.objectKey, contentType: upload.contentType, type, of })
      .pipe(Effect.mapError(unavailable))
    const at = yield* nowDate
    const updated = yield* stored(
      store.setBack(
        accountId,
        pieceId,
        { key: imageKey, uploadId: upload.id, at },
        yield* receiptRow(operation, pieceId),
      ),
    )
    if (Option.isNone(updated)) return yield* NotFound.make({})
    // The back it replaced goes, and the upload's own photo once a cut-out stands for it.
    const replaced = [piece.backImageKey, imageKey === upload.objectKey ? null : upload.objectKey]
    yield* forgetObjects(accountId, replaced.filter(Predicate.isNotNull), 'back')
    yield* backPicture(accountId, pieceId)
    return yield* ownerPiece(accountId, updated.value)
  }, Effect.provide(context)),
  /** Forget the back, and its picture unless a tray card still shows it. The receipt keeps the picture's key, so a
   * repeat forgets it again if the first request's delete was lost, and never removes a back set since. */
  removeBack: Effect.fn('Styld.Wardrobe.removeBack')(function* (pieceId: PieceId, operationId: OperationId) {
    const { accountId } = yield* CurrentAccount
    const store = yield* WardrobeStore
    const write = Effect.gen(function* () {
      const piece = yield* ownPiece(pieceId)
      const update = store.updatePiece(accountId, pieceId, { backImageKey: null, updatedAt: yield* nowDate })
      return { statements: [update], result: piece.backImageKey ?? '' }
    })
    return yield* store.recorded(
      { accountId, operationId, command: 'removeBack', input: pieceId },
      {
        write,
        answer: (removed) =>
          Effect.gen(function* () {
            if (removed !== '') yield* forgetObjects(accountId, [removed], 'back')
            yield* backPicture(accountId, pieceId)
            return yield* ownerPiece(accountId, yield* ownPiece(pieceId))
          }),
      },
    )
  }, Effect.provide(context)),
}))
