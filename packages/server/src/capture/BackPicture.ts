import type { Unavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import type { BackPictureRow } from './BackPictureStore.ts'
import { cutoutAt, drawingOf, frontOf, removeObject } from './Drawing.ts'
import { backPictureKey, storedAs } from './Shared.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { nowDate } from '../kernel/Db.ts'
import type { CaptureServices } from './Shared.ts'

// A pressed picture of a piece's back (owner, 4 November 2026: Eva wants to see a piece turned, not three pictures of
// its front). Drawn only from a back the person photographed, never invented; free, like the front's first drawing.
// Every write to `piece_back_pictures` is this module's: a back set, replaced or removed only asks the queue to bring
// the row in line with the piece (`DrawBackPicture`), so a lost message is made up by the next one or the operator's
// backfill.

/** The back's drawing: from the back cut-out, with the front cut-out for colour and identity, always drawn and never
 * judged first (owner, 4 November: the face gate is gone, `Policy.ts`); a back kept as its uncut photo is not drawn. */
const back = drawingOf<BackPictureRow, Unavailable, CaptureServices>({
  side: 'back',
  kind: () => 'back',
  find: (pieceId) => Effect.flatMap(CaptureStore, (store) => storedAs(store.findBackPicture(pieceId))),
  write: (pieceId, from, changes) =>
    Effect.flatMap(CaptureStore, (store) => storedAs(store.moveBackPicture(pieceId, from, changes))),
  keyOf: (row, version) => backPictureKey(row.accountId, row.pieceId, version),
  cutouts: (piece) => Effect.all({ subject: cutoutAt(piece.backImageKey), other: frontOf(piece) }),
  plan: () => Effect.succeed('draw'),
  hint: () => Option.none(),
  after: () => Effect.void,
})

/** Bring the back picture in line with the piece: forgotten, with its drawing, when the piece has no back; queued when
 * it has none yet or its back changed. */
const reconcile = (accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    const store = yield* CaptureStore
    const piece = yield* storedAs((yield* WardrobeStore).findPiece(accountId, pieceId))
    const sourceKey = Option.flatMap(piece, (row) => Option.fromNullishOr(row.backImageKey))
    if (Option.isNone(sourceKey)) {
      const dropped = yield* storedAs(store.dropBackPicture(pieceId))
      yield* Effect.forEach(dropped, removeObject, { discard: true })
      return
    }
    const current = yield* storedAs(store.findBackPicture(pieceId))
    if (Option.isSome(current) && current.value.sourceKey === sourceKey.value) return
    yield* storedAs(store.queueBackPicture({ pieceId, accountId, sourceKey: sourceKey.value }, yield* nowDate))
  })

/** The queue side of back pictures. */
export const backPicturing = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Bring a piece's back picture in line with its back, and carry it as far as it goes. */
  processBackPicture: Effect.fn('Styld.Picture.processBack')(function* (accountId: string, pieceId: string) {
    yield* reconcile(accountId, pieceId)
    yield* back.process(pieceId)
  }, Effect.provide(context)),
  /** The last attempt failed: the back photo stays. A drawing that may have been made counts as unknown. */
  failBackPicture: Effect.fn('Styld.Picture.failBack')(function* (pieceId: string) {
    yield* back.fail(pieceId)
  }, Effect.provide(context)),
}))
