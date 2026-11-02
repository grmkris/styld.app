import { DateTime, Duration, Effect, Option } from 'effect'
import { nowDate } from '../kernel/Db.ts'
import { deleteKeys, Media } from '../kernel/Media.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import { Holds, holdId } from '../usage/Holds.ts'
import { stored, typeOf, type WardrobeServices } from './Shared.ts'
import { GarmentCutout, pieceAttempts } from './Processing.ts'
import { WardrobeStore } from './Store.ts'

/** Bytes received but used by nothing are kept this long after their upload path expired. */
const unusedPatience = Duration.days(1)
const uploadBatch = 50

/** A piece's work on the queue, and the sweep of uploads nothing used. */
export const processing = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  /** Run the cut-out step for a piece the queue delivered (its `attempt`th delivery). Finished pieces are left
   * alone. */
  processPiece: Effect.fn('Styld.Wardrobe.processPiece')(function* (pieceId: string, attempt: number) {
    const store = yield* WardrobeStore
    const row = yield* stored(store.findPieceForProcessing(pieceId))
    if (Option.isNone(row) || row.value.status !== 'processing') return
    const type = yield* typeOf(row.value)
    const { imageKey } = yield* (yield* GarmentCutout).cut({
      accountId: row.value.accountId,
      pieceId,
      originalKey: row.value.originalKey,
      contentType: row.value.contentType,
      type,
      of: { side: 'front', attempt },
    })
    yield* stored(store.finishProcessing(pieceId, { status: 'ready', imageKey, updatedAt: yield* nowDate }))
    yield* (yield* PieceChanged).changed(pieceId)
  }, Effect.provide(context)),
  /** The queue or the sweep gave up on a piece: it shows as failed rather than processing forever, and a credit a
   * delivery that died still held comes back. */
  failPiece: Effect.fn('Styld.Wardrobe.failPiece')(function* (pieceId: string) {
    const store = yield* WardrobeStore
    const holds = yield* Holds
    const row = yield* stored(store.findPieceForProcessing(pieceId))
    if (Option.isNone(row) || row.value.status !== 'processing') return
    yield* stored(store.finishProcessing(pieceId, { status: 'failed', imageKey: null, updatedAt: yield* nowDate }))
    const attempts = Array.from({ length: pieceAttempts }, (_, index) => index + 1)
    yield* Effect.forEach(
      attempts,
      (attempt) => holds.settle(row.value.accountId, holdId('piece', pieceId, attempt), 'failed'),
      { discard: true },
    )
  }, Effect.provide(context)),
  /** The sweep of uploads nothing used: their bytes, then their rows. */
  sweepUploads: Effect.fn('Styld.Wardrobe.sweepUploads')(function* () {
    const store = yield* WardrobeStore
    const now = yield* DateTime.now
    const unused = yield* stored(
      store.unusedUploads(
        DateTime.toDateUtc(now),
        DateTime.toDateUtc(DateTime.subtractDuration(now, unusedPatience)),
        uploadBatch,
      ),
    )
    yield* deleteKeys(
      (yield* Media).bucket,
      unused.map(({ objectKey }) => objectKey),
    )
    yield* Effect.forEach(unused, ({ id }) => stored(store.forgetUpload(id)), { discard: true })
    return unused.length
  }, Effect.provide(context)),
}))
