import { NotFound, PictureRefused, prices, type RedrawPicture } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { isStale, pictureView } from '../wardrobe/Shown.ts'
import { enqueuePicture, type Parts, storedAs } from './Parts.ts'
import { redrawHold, settleHold } from './Pictures.ts'
import { capturePolicy } from './Policy.ts'
import type { PictureRow } from './Store.ts'
import { once } from '../kernel/Receipts.ts'
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
    const piece = yield* storedAs(parts.wardrobeStore.findPiece(accountId, pieceId))
    if (Option.isNone(piece)) return yield* NotFound.make({})
    if (!isCutout(piece.value)) return yield* PictureRefused.make({ reason: 'photo' })
  })

/** Hold the redraw's credit and queue the picture, moving it on from the state it was read in. A request that lost
 * the race gets its credit back. */
const queueRedraw = (
  parts: Parts,
  ids: { readonly accountId: string; readonly pieceId: string },
  current: Option.Option<PictureRow>,
  hint: string | undefined,
) =>
  Effect.gen(function* () {
    const { accountId, pieceId } = ids
    const redraws = Option.match(current, { onNone: () => 1, onSome: (picture) => picture.redraws + 1 })
    const hold = redrawHold({ pieceId, redraws })
    const holds = parts.holds
    yield* holds.reserve({ accountId, hold, credits: prices.redraw })
    const at = yield* nowDate
    const queued = {
      state: 'queued' as const,
      hint: hint ?? null,
      redraws,
      paid: true,
      shown: null,
      errorCode: null,
      updatedAt: at,
    }
    const moved = yield* storedAs(
      Option.isSome(current)
        ? parts.store.movePicture(pieceId, [current.value.state], queued)
        : parts.store.addPicture({ ...queued, pieceId, accountId, version: 0, createdAt: at }),
    ).pipe(Effect.tapError(() => holds.settle(accountId, hold, 'failed').pipe(Effect.ignore)))
    if (!moved) {
      yield* holds.settle(accountId, hold, 'failed')
      return yield* PictureRefused.make({ reason: 'busy' })
    }
    // A drawing being redrawn stops showing; the photo shows meanwhile.
    yield* parts.pieceChanged.changed(pieceId)
    yield* enqueuePicture(parts, pieceId)
  })

/** The picture a repeated redraw asked for, as it stands now; one still queued goes to the queue again. */
const replayedRedraw = (parts: Parts, pieceId: string) =>
  Effect.gen(function* () {
    const at = yield* nowDate
    const current = yield* storedAs(parts.store.findPicture(pieceId))
    if (Option.isNone(current)) return yield* NotFound.make({})
    if (current.value.state === 'queued') yield* enqueuePicture(parts, pieceId)
    return pictureView(current.value, at)
  })

/** The owner's own requests for clean pictures. */
export const redrawing = (parts: Parts) => ({
  /** Draw a piece's clean picture again, with the owner's words about it, for a credit held until the drawing ends:
   * consumed for one they can see, refunded otherwise. The new drawing replaces the last. Repeating an operation id
   * answers the first request. */
  redrawPicture: Effect.fn('Styld.Picture.redraw')(function* (pieceId: string, input: RedrawPicture) {
    const { accountId } = yield* CurrentAccount
    yield* drawablePiece(parts, accountId, pieceId)
    const ask = Effect.gen(function* () {
      const current = yield* settledPicture(parts, pieceId, yield* nowDate)
      const face = capturePolicy.pictures.face
      const refused = Option.flatMap(current, (picture) => refusal(picture, face))
      if (Option.isSome(refused)) return yield* PictureRefused.make({ reason: refused.value })
      yield* queueRedraw(parts, { accountId, pieceId }, current, input.hint)
      const version = Option.match(current, { onNone: () => 0, onSome: (picture) => picture.version })
      return [{ state: 'drawing' as const, shows: 'photo' as const, version }, pieceId] as const
    })
    return yield* once(
      parts.wardrobeStore,
      { accountId, operationId: input.operationId, command: 'redrawPicture', input: [pieceId, input.hint ?? null] },
      // The same request again: its message may have been lost, and the job draws once however often it is sent.
      { replay: () => replayedRedraw(parts, pieceId), run: ask },
    )
  }),
})
