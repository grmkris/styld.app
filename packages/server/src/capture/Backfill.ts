import { CurrentOperator, type PictureBackfilled } from '@styld/protocol'
import { Array, DateTime, Duration, Effect, Option } from 'effect'
import { PieceQueue, type WorkMessage } from '../wardrobe/Processing.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import { storedAs, unavailable } from './Shared.ts'
import { CaptureStore } from './Store.ts'
import type { CaptureServices } from './Shared.ts'

// A clean picture for every piece (owner, 4 November 2026). Most of a tester's 370 pieces were kept before pictures
// were drawn, or came over from v1, and never had one; the operator asks for them, one account at a time. Each piece
// with none gets a picture queued as if it had just been kept: drawn on the piece queue by the same job, at the same
// bars (`Policy.ts`), and paid by Styld (a backfilled picture is not `paid`, so it holds none of the person's credits).
// A piece is drawn once: its picture row is the receipt, so running again queues nothing twice. When the prompt changes
// (owner, 4 November: the pressed prompt), a run given a moment draws again the drawings that ended before it.

/** How many backfilled pictures reach the queue a minute: one delivery batch of the piece queue, so a whole wardrobe
 * never lands on Muse at once beside the pictures of new captures. */
const perMinute = 10
/** The most pictures one run queues, an hour of them at that pace; a run says how many remain for the next. */
const perRun = 600
/** The most drawings one run queues to be drawn again: a minute's worth, since a piece waiting for its new drawing shows
 * its cut-out, and the operator's script runs again each minute until none remain (`tools/backfill-pictures.ts`). */
const perRedraw = perMinute
/** Queues take at most this many messages a call. */
const sendBatch = 100
/** A backfilled picture still waiting this long after its turn lost its message; a run sends it again (the job draws
 * a picture once however often it is sent). */
const overdueAfter = Duration.minutes(2)

/** The seconds a picture waits for its turn: the `index`th of a run goes in minute `index / perMinute`. */
const delayOf = (index: number) => Math.floor(index / perMinute) * 60

/** Send each message to the queue in its turn. */
const sendPaced = (bodies: ReadonlyArray<WorkMessage>) =>
  Effect.gen(function* () {
    const queue = yield* PieceQueue
    yield* Effect.forEach(
      Array.chunksOf(
        bodies.map((body, index) => ({ body, delaySeconds: delayOf(index) })),
        sendBatch,
      ),
      (chunk) => Effect.tryPromise({ try: () => queue.sendBatch(chunk), catch: unavailable }),
      { discard: true },
    )
  })

/** Send each piece's picture to the queue in its turn. */
const send = (pieceIds: ReadonlyArray<string>) =>
  sendPaced(pieceIds.map((pieceId) => ({ _tag: 'DrawPicture' as const, pieceId })))

/** The account's photographed backs that have no drawing yet, each asked of the back picture job in its turn (owner,
 * 4 November), at most `perRun`; the job brings each piece's row in line, so a repeat draws nothing twice. */
const backfillBacks = (accountId: string) =>
  Effect.gen(function* () {
    const undrawn = yield* storedAs((yield* CaptureStore).undrawnBacks(accountId))
    const chosen = undrawn.slice(0, perRun)
    yield* sendPaced(chosen.map((pieceId) => ({ _tag: 'DrawBackPicture' as const, accountId, pieceId })))
    yield* Effect.annotateCurrentSpan('styld.backfill.backs', chosen.length)
    return { queued: chosen.length, shown: 0, remaining: undrawn.length - chosen.length }
  })

/** The operator's backfill of clean pictures. */
export const backfilling = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Queue a clean picture for each of the account's ready cut-outs that has none, newest first and at most `perRun`,
   * or, given `redrawBefore`, draw again at most `perRedraw` of its drawings that ended before then (a changed prompt);
   * show the drawings it was proposed before 4 November; and send again any of its pictures whose message was lost. */
  backfillPictures: Effect.fn('Styld.Picture.backfill')(function* (
    accountId: string,
    redrawBefore: Option.Option<Date> = Option.none(),
    backs = false,
  ) {
    yield* CurrentOperator
    if (backs) return yield* backfillBacks(accountId)
    const store = yield* CaptureStore
    const now = yield* DateTime.now
    const at = DateTime.toDateUtc(now)
    const shown = yield* storedAs(store.showProposed(accountId, at))
    // What others see of a public piece changed.
    const changes = yield* PieceChanged
    yield* Effect.forEach(shown, (pieceId) => changes.changed(pieceId), { discard: true })
    const overdue = yield* storedAs(
      store.overduePictures(accountId, DateTime.toDateUtc(DateTime.subtractDuration(now, overdueAfter))),
    )
    const turnOf = (index: number) =>
      DateTime.toDateUtc(DateTime.addDuration(now, Duration.seconds(delayOf(overdue.length + index))))
    if (Option.isSome(redrawBefore)) {
      const stale = yield* storedAs(store.staleDrawings(accountId, redrawBefore.value))
      const again = stale.slice(0, perRedraw)
      const requeued = yield* storedAs(
        store.requeueDrawings(
          again.map((pieceId, index) => ({ pieceId, turn: turnOf(index) })),
          redrawBefore.value,
        ),
      )
      yield* send([...overdue, ...requeued])
      yield* Effect.annotateCurrentSpan({
        'styld.backfill.redrawn': requeued.length,
        'styld.backfill.shown': shown.length,
        'styld.backfill.overdue': overdue.length,
      })
      return { queued: requeued.length, shown: shown.length, remaining: stale.length - again.length }
    }
    const undrawn = yield* storedAs(store.undrawnPieces(accountId))
    const chosen = undrawn.slice(0, perRun)
    // A picture's turn is when it was last moved: the sweep gives up on one still queued half an hour after its turn,
    // not after the run.
    const added = yield* storedAs(
      store.addPictures(
        chosen.map((pieceId, index) => ({
          pieceId,
          accountId,
          state: 'queued' as const,
          version: 0,
          redraws: 0,
          paid: false,
          createdAt: at,
          updatedAt: turnOf(index),
        })),
      ),
    )
    yield* send([...overdue, ...added])
    yield* Effect.annotateCurrentSpan({
      'styld.backfill.queued': added.length,
      'styld.backfill.shown': shown.length,
      'styld.backfill.overdue': overdue.length,
    })
    return {
      queued: added.length,
      shown: shown.length,
      remaining: undrawn.length - chosen.length,
    } satisfies Omit<PictureBackfilled, 'accountId'>
  }, Effect.provide(context)),
}))
