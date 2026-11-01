import { NotFound, PictureRefused, prices, type RedrawPicture } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { isStale, pictureView } from '../wardrobe/Shown.ts'
import { enqueuePicture, type Parts, storedAs } from './Parts.ts'
import { settleHold } from './Pictures.ts'
import { CaptureConfig } from './Policy.ts'
import type { PictureRow } from './Store.ts'
import { Usage } from './Usage.ts'
import { nowDate } from '../kernel/Db.ts'

/** Whether a piece shows a cut-out, the only picture that may be sent to be drawn; a photo never leaves Styld. */
const isCutout = (piece: { readonly imageKey: string | null; readonly originalKey: string }) =>
  piece.imageKey !== null && piece.imageKey !== piece.originalKey

/** The piece's picture after settling what a delivery left: a claim no delivery can finish ends as unknown, and an
 * ended redraw's credit is settled. */
const settledPicture = (parts: Parts, pieceId: string, at: Date) =>
  Effect.gen(function* () {
    const found = yield* storedAs(parts.store.findPicture(pieceId))
    if (Option.isSome(found) && isStale(found.value, at))
      yield* storedAs(
        parts.store.movePicture(pieceId, ['generating'], { state: 'failed', errorCode: 'unknown', updatedAt: at }),
      )
    yield* settleHold(parts, pieceId)
    return yield* storedAs(parts.store.findPicture(pieceId))
  })

/** Why the piece's picture cannot be redrawn nowDate, if it cannot. */
const refusal = (picture: PictureRow, face: number): Option.Option<PictureRefused['reason']> => {
  if ((picture.face ?? 0) >= face) return Option.some('face')
  return ['queued', 'generating', 'checking'].includes(picture.state) ? Option.some('busy') : Option.none()
}

/** The owner's piece, if it can be drawn: clean pictures are on and it shows a cut-out. */
const drawablePiece = (parts: Parts, accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    if ((yield* CaptureConfig).pictures.generator === 'off') return yield* PictureRefused.make({ reason: 'off' })
    const piece = yield* storedAs(parts.wardrobeStore.findPiece(accountId, pieceId))
    if (Option.isNone(piece)) return yield* NotFound.make({})
    if (!isCutout(piece.value)) return yield* PictureRefused.make({ reason: 'photo' })
  })

/** Hold the redraw's credit and queue the picture, moving it on from the state it was read in. A request that lost
 * the race gets its credit back. */
const queueRedraw = (
  parts: Parts,
  ids: { readonly accountId: string; readonly pieceId: string; readonly hold: string },
  current: Option.Option<PictureRow>,
  hint: string | undefined,
) =>
  Effect.gen(function* () {
    const { accountId, pieceId, hold } = ids
    const usage = yield* Usage
    yield* usage.reserve(accountId, hold, prices.redraw)
    const at = yield* nowDate
    const queued = { state: 'queued' as const, hint: hint ?? null, hold, shown: null, errorCode: null, updatedAt: at }
    const moved = Option.isSome(current)
      ? yield* storedAs(parts.store.movePicture(pieceId, [current.value.state], queued))
      : yield* storedAs(parts.store.addPicture({ ...queued, pieceId, accountId, version: 0, createdAt: at }))
    if (!moved) {
      yield* usage.settle(accountId, hold, 'refunded')
      return yield* PictureRefused.make({ reason: 'busy' })
    }
    // A drawing being redrawn stops showing; the photo shows meanwhile.
    yield* parts.pieceChanged.changed(pieceId)
    yield* enqueuePicture(parts, pieceId)
  })

/** The owner's own requests for clean pictures. */
export const redrawing = (parts: Parts) => ({
  /** Draw a piece's clean picture again, with the owner's words about it, for a credit held until the drawing ends:
   * consumed for one they can see, refunded otherwise. The new drawing replaces the last. Repeating an operation id
   * answers the first request. */
  redrawPicture: Effect.fn('Styld.Picture.redraw')(function* (pieceId: string, input: RedrawPicture) {
    const { accountId } = yield* CurrentAccount
    yield* drawablePiece(parts, accountId, pieceId)
    const at = yield* nowDate
    const hold = `picture/${input.operationId}`
    const current = yield* settledPicture(parts, pieceId, at)
    if (Option.isSome(current) && current.value.hold === hold) {
      // The same request again: its message may have been lost, and the job draws once however often it is sent.
      if (current.value.state === 'queued') yield* enqueuePicture(parts, pieceId)
      return pictureView(current.value, at)
    }
    const face = (yield* CaptureConfig).pictures.face
    const refused = Option.flatMap(current, (picture) => refusal(picture, face))
    if (Option.isSome(refused)) return yield* PictureRefused.make({ reason: refused.value })
    yield* queueRedraw(parts, { accountId, pieceId, hold }, current, input.hint)
    const version = Option.match(current, { onNone: () => 0, onSome: (picture) => picture.version })
    return { state: 'drawing' as const, shows: 'photo' as const, version }
  }),
  /** How many of the account's kept cut-outs have no clean picture yet. */
  undrawnPictures: Effect.fn('Styld.Picture.undrawn')(function* () {
    const { accountId } = yield* CurrentAccount
    const policy = (yield* CaptureConfig).pictures
    if (policy.generator === 'off') return { pieces: 0 }
    return { pieces: (yield* storedAs(parts.store.undrawnPieces(accountId, policy.face))).length }
  }),
  /** Queue a free clean picture for each of them, as a keep would have, and send again any still waiting. */
  drawPictures: Effect.fn('Styld.Picture.backfill')(function* () {
    const { accountId } = yield* CurrentAccount
    const policy = (yield* CaptureConfig).pictures
    if (policy.generator === 'off') return { pieces: 0 }
    const undrawn = yield* storedAs(parts.store.undrawnPieces(accountId, policy.face))
    const at = yield* nowDate
    yield* storedAs(
      parts.store.addPictures(
        undrawn.map((pieceId) => ({ pieceId, accountId, state: 'queued', version: 0, createdAt: at, updatedAt: at })),
      ),
    )
    yield* storedAs(parts.store.requeueKeptClean(accountId, policy.face, at))
    const waiting = yield* storedAs(parts.store.queuedPicturesOf(accountId))
    yield* Effect.forEach(waiting, (pieceId) => enqueuePicture(parts, pieceId), { discard: true })
    return { pieces: undrawn.length }
  }),
})
