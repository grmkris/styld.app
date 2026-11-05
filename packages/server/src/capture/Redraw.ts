import { CurrentAccount, NotFound, PictureRefused, prices, type RedrawPicture } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { isStale, pictureView } from '../wardrobe/Shown.ts'
import { enqueuePicture } from './Shared.ts'
import { redrawHold, settleHold } from './Pictures.ts'
import { firstPictureState, hasEnded } from './PictureLifecycle.ts'
import type { PictureRow } from './Store.ts'
import { once } from '../kernel/Receipts.ts'
import { nowDate, stored } from '../kernel/Db.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { Holds } from '../usage/Holds.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import type { CaptureServices } from './Shared.ts'

/** Whether a piece shows a cut-out, the only picture that may be sent to be drawn; a photo never leaves Styld. */
const isCutout = (piece: { readonly imageKey: string | null; readonly originalKey: string }) =>
  piece.imageKey !== null && piece.imageKey !== piece.originalKey

/** The piece's picture after settling what a delivery left: a claim no delivery can finish ends as unknown, and an
 * ended redraw's credit is settled. */
const settledPicture = (pieceId: string, at: Date) =>
  Effect.gen(function* () {
    const found = yield* stored((yield* CaptureStore).findPicture(pieceId))
    if (Option.isSome(found) && isStale(found.value, at))
      yield* stored((yield* CaptureStore).movePicture(pieceId, ['generating'], 'failed', { updatedAt: at }))
    yield* settleHold(pieceId)
    return yield* stored((yield* CaptureStore).findPicture(pieceId))
  })

/** Why the piece's picture cannot be redrawn nowDate, if it cannot. */
const refusal = (picture: PictureRow): Option.Option<PictureRefused['reason']> =>
  hasEnded(picture.state) ? Option.none() : Option.some('busy')

/** The owner's piece, if it can be drawn: clean pictures are on and it shows a cut-out. */
const drawablePiece = (accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    const piece = yield* stored((yield* WardrobeStore).findPiece(accountId, pieceId))
    if (Option.isNone(piece)) return yield* NotFound.make({})
    if (!isCutout(piece.value)) return yield* PictureRefused.make({ reason: 'photo' })
  })

/** A claimed redraw whose credit could not be held: its hold refunded (whatever the Wallet did, it paid for nothing),
 * then the picture as it was, keeping the redraw's number so its hold is never named again. */
const unclaimed = (accountId: string, current: Option.Option<PictureRow>, claimed: Pick<PictureRow, 'pieceId'>) =>
  Effect.gen(function* () {
    const { pieceId } = claimed
    const redraws = Option.match(current, { onNone: () => 1, onSome: (picture) => picture.redraws + 1 })
    yield* (yield* Holds).settle(accountId, redrawHold({ pieceId, redraws }), 'failed')
    const store = yield* CaptureStore
    yield* Option.match(current, {
      onNone: () => store.dropPicture(pieceId, redraws),
      onSome: ({ state, hint, paid, shown, updatedAt }) =>
        store.claimRedraw(pieceId, { state: firstPictureState, redraws }, state, { hint, paid, shown, updatedAt }),
    })
  }).pipe(Effect.ignore({ log: true, message: 'Styld.Picture.redraw could not take back a claim' }))

/** Claim the picture's next redraw, moving it on from the state and redraw it was read in, then hold its credit and
 * queue it. Only the request that claimed the redraw holds and settles its credit: one that lost the race holds
 * nothing and is told the picture is busy. */
const queueRedraw = (
  ids: { readonly accountId: string; readonly pieceId: string },
  current: Option.Option<PictureRow>,
  hint: string | undefined,
) =>
  Effect.gen(function* () {
    const { accountId, pieceId } = ids
    const redraws = Option.match(current, { onNone: () => 1, onSome: (picture) => picture.redraws + 1 })
    const at = yield* nowDate
    const queued = {
      hint: hint ?? null,
      redraws,
      paid: true,
      shown: null,
      updatedAt: at,
    }
    const store = yield* CaptureStore
    const claimed = yield* stored(
      Option.isSome(current)
        ? store.claimRedraw(pieceId, current.value, firstPictureState, queued)
        : store.addPicture({ ...queued, state: firstPictureState, pieceId, accountId, version: 0, createdAt: at }),
    )
    if (!claimed) return yield* PictureRefused.make({ reason: 'busy' })
    yield* (yield* Holds)
      .reserve({ accountId, hold: redrawHold({ pieceId, redraws }), credits: prices.redraw })
      .pipe(Effect.tapError(() => unclaimed(accountId, current, { pieceId })))
    // A drawing being redrawn stops showing; the photo shows meanwhile.
    yield* (yield* PieceChanged).changed(pieceId)
    yield* enqueuePicture(pieceId)
  })

/** The picture a repeated redraw asked for, as it stands now; one still queued goes to the queue again. */
const replayedRedraw = (pieceId: string) =>
  Effect.gen(function* () {
    const at = yield* nowDate
    const current = yield* stored((yield* CaptureStore).findPicture(pieceId))
    if (Option.isNone(current)) return yield* NotFound.make({})
    if (current.value.state === firstPictureState) yield* enqueuePicture(pieceId)
    return pictureView(current.value, at)
  })

/** The owner's own requests for clean pictures. */
export const redrawing = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Draw a piece's clean picture again, with the owner's words about it, for a credit held until the drawing ends:
   * consumed for one they can see, refunded otherwise. The new drawing replaces the last. Repeating an operation id
   * answers the first request. */
  redrawPicture: Effect.fn('Styld.Picture.redraw')(function* (pieceId: string, input: RedrawPicture) {
    const { accountId } = yield* CurrentAccount
    yield* drawablePiece(accountId, pieceId)
    const ask = Effect.gen(function* () {
      const current = yield* settledPicture(pieceId, yield* nowDate)
      const refused = Option.flatMap(current, refusal)
      if (Option.isSome(refused)) return yield* PictureRefused.make({ reason: refused.value })
      yield* queueRedraw({ accountId, pieceId }, current, input.hint)
      const version = Option.match(current, { onNone: () => 0, onSome: (picture) => picture.version })
      return [{ state: 'drawing' as const, shows: 'photo' as const, version }, pieceId] as const
    })
    return yield* once(
      yield* WardrobeStore,
      { accountId, operationId: input.operationId, command: 'redrawPicture', input: [pieceId, input.hint ?? null] },
      // The same request again: its message may have been lost, and the job draws once however often it is sent. A
      // request that died while it asked is answered as the picture stands, never asked again.
      { replay: () => replayedRedraw(pieceId), run: ask, resume: replayedRedraw(pieceId) },
    )
  }, Effect.provide(context)),
}))
