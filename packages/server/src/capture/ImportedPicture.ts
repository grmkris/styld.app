import { Effect, Option } from 'effect'
import { nowDate, stored } from '../kernel/Db.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { enqueuePicture } from './Shared.ts'
import { CaptureStore } from './Store.ts'
import type { CaptureServices } from './Shared.ts'

// A piece brought over from v1 gets a clean picture as a piece kept from the review tray does (owner, 4 November
// 2026): once it is ready with a real cut-out, its first drawing is queued, drawn by the same job at the same bars
// (`Policy.ts`) and paid by Styld, since an import never touches the person's credits. The picture row is the receipt:
// a redelivered import adds none twice, and sends again only a picture still waiting for the queue (the job draws a
// picture once however often it is sent).

/** Queue the first drawing of an imported piece that is ready as a cut-out; a piece still processing, failed, or kept
 * as its photo (which never leaves Styld) gets none.
 * @internal Exported for its tests. */
export const queueImportedPicture = Effect.fn('Styld.Picture.imported')(function* (pieceId: string) {
  const piece = yield* stored((yield* WardrobeStore).findPieceForProcessing(pieceId))
  if (Option.isNone(piece)) return
  const { accountId, status, imageKey, originalKey, source } = piece.value
  if (source !== 'import' || status !== 'ready' || imageKey === null || imageKey === originalKey) return
  // A house garment the seed generated already is a clean picture: it is never drawn again.
  if ((yield* stored((yield* WardrobeStore).generatedAmong([pieceId]))).has(pieceId)) return
  const store = yield* CaptureStore
  const at = yield* nowDate
  yield* stored(
    store.addPicture({
      pieceId,
      accountId,
      state: 'queued',
      version: 0,
      redraws: 0,
      paid: false,
      createdAt: at,
      updatedAt: at,
    }),
  )
  if ((yield* stored(store.waitingPictures([pieceId]))).length > 0) yield* enqueuePicture(pieceId)
})

/** Clean pictures for imported pieces, which the import queue asks for. */
export const importing = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Queue an imported piece's first clean picture once it is ready as a cut-out, paid by Styld. */
  drawImported: (pieceId: string) => queueImportedPicture(pieceId).pipe(Effect.provide(context)),
}))
