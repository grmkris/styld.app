import { NotFound, type PieceId, type SetBack } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { ownerPiece, ownPiece, type Parts, stored, typeOf, unavailable, usableUpload } from './Parts.ts'
import { nowDate } from '../kernel/Db.ts'
import { identify, priorResult, receiptRow } from '../kernel/Receipts.ts'

/** A back of the piece: the person's photo of it, cut out like the front, for a photo's credit (owner, 2026-10-31).
 * Repeating the operation answers the piece again; a cut-out that could not be made keeps the photo. */
export const backing = (parts: Parts) => ({
  setBack: Effect.fn('Styld.Wardrobe.setBack')(function* (pieceId: PieceId, input: SetBack) {
    const { accountId } = yield* CurrentAccount
    const piece = yield* ownPiece(parts)(pieceId)
    const operation = yield* identify({
      accountId,
      operationId: input.operationId,
      command: 'setBack',
      input: [pieceId, input.uploadId],
    })
    const prior = yield* priorResult(operation, yield* stored(parts.store.findReceipt(accountId, input.operationId)))
    if (Option.isSome(prior)) return yield* ownerPiece(parts, accountId, piece)
    const upload = yield* usableUpload(parts.store, accountId, input.uploadId)
    const of = { side: 'back' as const, uploadId: upload.id }
    const type = yield* typeOf(piece)
    const { imageKey } = yield* parts.cutout
      .cut({ accountId, pieceId, originalKey: upload.objectKey, contentType: upload.contentType, type, of })
      .pipe(
        Effect.tapError(() => parts.cutout.release({ accountId, pieceId, of }).pipe(Effect.ignore)),
        Effect.mapError(unavailable),
      )
    const at = yield* nowDate
    const updated = yield* stored(
      parts.store.setBack(
        accountId,
        pieceId,
        { key: imageKey, uploadId: upload.id, at },
        yield* receiptRow(operation, pieceId),
      ),
    )
    if (Option.isNone(updated)) return yield* NotFound.make({})
    return yield* ownerPiece(parts, accountId, updated.value)
  }),
  /** Forget the back. Its picture stays stored until the account goes: a tray card may still show it. */
  removeBack: Effect.fn('Styld.Wardrobe.removeBack')(function* (pieceId: PieceId) {
    const { accountId } = yield* CurrentAccount
    yield* ownPiece(parts)(pieceId)
    const updated = yield* stored(
      parts.store.updatePiece(accountId, pieceId, { backImageKey: null, updatedAt: yield* nowDate }),
    )
    if (Option.isNone(updated)) return yield* NotFound.make({})
    return yield* ownerPiece(parts, accountId, updated.value)
  }),
})
