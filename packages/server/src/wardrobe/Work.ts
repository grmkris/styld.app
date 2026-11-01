import { DateTime, Duration, Effect, Option } from 'effect'
import { nowDate } from '../kernel/Db.ts'
import { deleteKeys } from '../kernel/Media.ts'
import { holdId } from '../usage/Holds.ts'
import { type Parts, stored, typeOf } from './Parts.ts'
import { pieceAttempts } from './Processing.ts'

/** Bytes received but used by nothing are kept this long after their upload path expired. */
const unusedPatience = Duration.days(1)
const uploadBatch = 50

/** A piece's work on the queue, and the sweep of uploads nothing used. */
export const processing = (parts: Parts) => ({
  /** Run the cut-out step for a piece the queue delivered (its `attempt`th delivery). Finished pieces are left
   * alone. */
  processPiece: Effect.fn('Styld.Wardrobe.processPiece')(function* (pieceId: string, attempt: number) {
    const row = yield* stored(parts.store.findPieceForProcessing(pieceId))
    if (Option.isNone(row) || row.value.status !== 'processing') return
    const type = yield* typeOf(row.value)
    const { imageKey } = yield* parts.cutout.cut({
      accountId: row.value.accountId,
      pieceId,
      originalKey: row.value.originalKey,
      contentType: row.value.contentType,
      type,
      of: { side: 'front', attempt },
    })
    yield* stored(parts.store.finishProcessing(pieceId, { status: 'ready', imageKey, updatedAt: yield* nowDate }))
    yield* parts.pieceChanged.changed(pieceId)
  }),
  /** The queue or the sweep gave up on a piece: it shows as failed rather than processing forever, and a credit a
   * delivery that died still held comes back. */
  failPiece: Effect.fn('Styld.Wardrobe.failPiece')(function* (pieceId: string) {
    const row = yield* stored(parts.store.findPieceForProcessing(pieceId))
    if (Option.isNone(row) || row.value.status !== 'processing') return
    yield* stored(
      parts.store.finishProcessing(pieceId, { status: 'failed', imageKey: null, updatedAt: yield* nowDate }),
    )
    const attempts = Array.from({ length: pieceAttempts }, (_, index) => index + 1)
    yield* Effect.forEach(
      attempts,
      (attempt) => parts.holds.settle(row.value.accountId, holdId('piece', pieceId, attempt), 'failed'),
      { discard: true },
    )
  }),
  /** The sweep of uploads nothing used: their bytes, then their rows. */
  sweepUploads: Effect.fn('Styld.Wardrobe.sweepUploads')(function* () {
    const now = yield* DateTime.now
    const unused = yield* stored(
      parts.store.unusedUploads(
        DateTime.toDateUtc(now),
        DateTime.toDateUtc(DateTime.subtractDuration(now, unusedPatience)),
        uploadBatch,
      ),
    )
    yield* deleteKeys(
      parts.bindings.bucket,
      unused.map(({ objectKey }) => objectKey),
    )
    yield* Effect.forEach(unused, ({ id }) => stored(parts.store.forgetUpload(id)), { discard: true })
    return unused.length
  }),
})
