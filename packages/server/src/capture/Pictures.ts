import { Effect, Option } from 'effect'
import { planFor } from './CleanPicture.ts'
import { drawingOf, frontOf, hasEnded, photoOf } from './Drawing.ts'
import { pictureKey, storedAs } from './Shared.ts'
import { judgedAt } from './Garments.ts'
import { GarmentVision } from './Providers.ts'
import { modelPicture, type Rgba } from '@styld/imaging'
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

/** Whether to draw a front from its cut-out: a redraw the owner asked for (it holds a credit) is drawn whatever the
 * cut-out shows, so the decision model is not asked; otherwise it judges the cut-out, and a fragment asks for a
 * retake. */
const planFront = (picture: PictureRow, subject: Rgba) =>
  picture.paid
    ? Effect.succeed('draw' as const)
    : Effect.gen(function* () {
        const judgement = yield* (yield* GarmentVision).judge(modelPicture(subject, judgedAt))
        yield* Effect.annotateCurrentSpan('styld.picture.verdict', judgement.verdict)
        return planFor(judgement)
      })

/** A piece's clean picture, its front drawn shop-style (`Drawing.ts`); the owner's words on a redraw go with it. */
const front = drawingOf<PictureRow, Unavailable, CaptureServices>({
  side: 'front',
  kind: (picture: PictureRow) => (picture.paid ? 'redraw' : 'first'),
  find: (pieceId) => Effect.flatMap(CaptureStore, (store) => storedAs(store.findPicture(pieceId))),
  write: (pieceId, from, changes) =>
    Effect.flatMap(CaptureStore, (store) => storedAs(store.movePicture(pieceId, from, changes))),
  keyOf: (picture, version) => pictureKey(picture.accountId, picture.pieceId, version),
  // The front alone: the back added nothing to it and could carry a back print onto the front (owner, 4 November).
  cutouts: (piece) => Effect.all({ subject: frontOf(piece), other: Effect.succeed(Option.none<Rgba>()) }),
  // Drawn from the cut-out turned by the piece's rotation (`frontOf`), and shown turned by what it is past that.
  drawnWith: (piece) => ({ drawnRotation: piece.rotation }),
  plan: planFront,
  photo: photoOf,
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
