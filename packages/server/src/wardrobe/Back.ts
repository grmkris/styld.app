import { CurrentAccount, NotFound, type PieceId, type SetBack } from '@styld/protocol'
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
import { GarmentCutout } from './Processing.ts'
import { WardrobeStore } from './Store.ts'
import { nowDate } from '../kernel/Db.ts'
import { identify, priorResult, receiptRow } from '../kernel/Receipts.ts'

/** A back of the piece: the person's photo of it, cut out like the front, for a photo's credit (owner, 2026-10-31).
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
    if (Option.isSome(prior)) return yield* ownerPiece(accountId, piece)
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
    return yield* ownerPiece(accountId, updated.value)
  }, Effect.provide(context)),
  /** Forget the back, and its picture unless a tray card still shows it. */
  removeBack: Effect.fn('Styld.Wardrobe.removeBack')(function* (pieceId: PieceId) {
    const { accountId } = yield* CurrentAccount
    const piece = yield* ownPiece(pieceId)
    const updated = yield* stored(
      (yield* WardrobeStore).updatePiece(accountId, pieceId, { backImageKey: null, updatedAt: yield* nowDate }),
    )
    if (Option.isNone(updated)) return yield* NotFound.make({})
    if (piece.backImageKey !== null) yield* forgetObjects(accountId, [piece.backImageKey], 'back')
    return yield* ownerPiece(accountId, updated.value)
  }, Effect.provide(context)),
}))
