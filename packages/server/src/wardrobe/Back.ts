import { OperationConflict, PieceNotFound, type PieceId, type SetBack } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { nowDate, ownerPiece, ownPiece, type Parts, stored, toPiece, unavailable, usableUpload } from './Parts.ts'

/** A back of the piece: the person's photo of it, cut out like the front, for a photo's credit (owner, 2026-10-31).
 * Repeating the operation answers the piece again; a cut-out that could not be made keeps the photo. */
export const backing = (parts: Parts) => ({
  setBack: Effect.fn('Styld.Wardrobe.setBack')(function* (pieceId: PieceId, input: SetBack) {
    const { accountId } = yield* CurrentAccount
    const piece = yield* ownPiece(parts)(pieceId)
    const inputDigest = yield* parts.digest(JSON.stringify(['back', pieceId, input.uploadId]))
    const receipt = yield* stored(parts.store.findReceipt(accountId, input.operationId))
    if (Option.isSome(receipt))
      return receipt.value.inputDigest === inputDigest
        ? yield* ownerPiece(parts, accountId, piece)
        : yield* OperationConflict.make({})
    const upload = yield* usableUpload(parts.store, accountId, input.uploadId)
    const of = { side: 'back' as const, uploadId: upload.id }
    const { type } = yield* toPiece(piece)
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
        { accountId, operationId: input.operationId, command: 'setBack', inputDigest, result: pieceId, createdAt: at },
      ),
    )
    if (Option.isNone(updated)) return yield* PieceNotFound.make({})
    return yield* ownerPiece(parts, accountId, updated.value)
  }),
  /** Forget the back. Its picture stays stored until the account goes: a tray card may still show it. */
  removeBack: Effect.fn('Styld.Wardrobe.removeBack')(function* (pieceId: PieceId) {
    const { accountId } = yield* CurrentAccount
    yield* ownPiece(parts)(pieceId)
    const updated = yield* stored(
      parts.store.updatePiece(accountId, pieceId, { backImageKey: null, updatedAt: yield* nowDate }),
    )
    if (Option.isNone(updated)) return yield* PieceNotFound.make({})
    return yield* ownerPiece(parts, accountId, updated.value)
  }),
})
