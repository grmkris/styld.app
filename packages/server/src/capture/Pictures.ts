import { Effect, Option } from 'effect'
import { planFor } from './CleanPicture.ts'
import { cutoutAt, drawingOf, frontOf, hasEnded } from './Drawing.ts'
import { pictureKey, storedAs } from './Shared.ts'
import { capturePolicy } from './Policy.ts'
import type { PictureRow } from './Store.ts'
import { holdId } from '../usage/Holds.ts'
import { CaptureStore } from './Store.ts'
import { Holds } from '../usage/Holds.ts'
import type { CaptureServices } from './Shared.ts'
import type { Unavailable } from '@styld/protocol'

/** The hold paying for a piece's latest redraw. */
export const redrawHold = (picture: Pick<PictureRow, 'pieceId' | 'redraws'>) =>
  holdId('picture', picture.pieceId, picture.redraws)

/** A redraw's credit, once its drawing ended: consumed for a drawing the owner can see, refunded otherwise. The first
 * settlement stands, so whoever comes next settles a hold a delivery left, and settling again is safe. */
export const settleHold = (pieceId: string) =>
  Effect.gen(function* () {
    const found = yield* storedAs((yield* CaptureStore).findPicture(pieceId))
    if (Option.isNone(found) || !found.value.paid || !hasEnded(found.value.state)) return
    const { accountId, state } = found.value
    yield* (yield* Holds).settle(
      accountId,
      redrawHold(found.value),
      state === 'ready' || state === 'proposed' ? 'succeeded' : 'failed',
    )
  })

/** A piece's clean picture, its front drawn shop-style (`Drawing.ts`). A redraw the owner asked for (it holds a
 * credit) is drawn whatever the verdict, unless a face may show; their words go with it. */
const front = drawingOf<PictureRow, Unavailable, CaptureServices>({
  side: 'front',
  kind: (picture: PictureRow) => (picture.paid ? 'redraw' : 'first'),
  find: (pieceId) => Effect.flatMap(CaptureStore, (store) => storedAs(store.findPicture(pieceId))),
  write: (pieceId, from, changes) =>
    Effect.flatMap(CaptureStore, (store) => storedAs(store.movePicture(pieceId, from, changes))),
  keyOf: (picture, version) => pictureKey(picture.accountId, picture.pieceId, version),
  cutouts: (piece) => Effect.all({ subject: frontOf(piece), other: cutoutAt(piece.backImageKey) }),
  plan: (picture, judgement) =>
    picture.paid && judgement.face < capturePolicy.pictures.face
      ? 'draw'
      : planFor(judgement, capturePolicy.pictures).plan,
  hint: (picture) => Option.fromNullishOr(picture.hint),
  after: settleHold,
})

/** The queue side of clean pictures. */
export const picturing = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Carry a piece's clean picture as far as it goes; a finished one only has a redraw's credit settled. */
  processPicture: Effect.fn('Styld.Picture.process')(function* (pieceId: string) {
    yield* front.process(pieceId)
  }, Effect.provide(context)),
  /** The last attempt failed: the photo stays. A drawing that may have been made counts as unknown. */
  failPicture: Effect.fn('Styld.Picture.fail')(function* (pieceId: string) {
    yield* front.fail(pieceId)
  }, Effect.provide(context)),
}))
