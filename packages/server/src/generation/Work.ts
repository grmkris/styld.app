import { isOutcomeUnknown } from '../providers/Errors.ts'
import { BoardId, CurrentAccount, ImageType, Mood, OperationId, PieceId } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import type { Picture } from '../capture/Providers.ts'
import { receivedUpload } from '../mcp/ImageImport.ts'
import { nowDate } from '../kernel/Db.ts'
import { type Deps, settleJob, stored, unavailable } from './Deps.ts'
import { stickerKey } from './PaintPrompt.ts'
import type { Wearable } from './Planner.ts'
import { stickerOf } from './Sticker.ts'
import type { JobRow, StickerRow } from './Store.ts'

// Taking a job further, one delivery of the generation queue at a time: draw a sticker once, or plan a mood board from
// the person's pieces and lay the board out. Every step reads where the job stands, so a redelivery picks up where the
// last one stopped.

/** A claimed drawing older than the painter's 90 s patience, plus storing it, belongs to a delivery that died. */
const patienceMillis = 3 * 60 * 1000

/** The most of the person's pieces a plan reads. */
const planReads = 40

const isMood = Schema.is(Mood)

/** The operation each of a job's board changes is written under, so a redelivery answers the same change. */
const boardOperation = (job: JobRow, change: 'sticker' | 'pins' | 'moods' | 'layout') =>
  OperationId.make(`gen-${job.id}-${change}`)

/** The person's ready pieces as the plan reads them: a short reference each, never an id, photo or note. */
const wardrobeOf = (deps: Deps) =>
  Effect.map(deps.wardrobe.listPieces(), (pieces) =>
    pieces
      .filter(({ status }) => status === 'ready')
      .slice(0, planReads)
      .map((piece, at) => ({
        wearable: {
          ref: `p${at + 1}`,
          name: piece.name ?? piece.type,
          type: piece.type,
          colours: piece.colours,
        } satisfies Wearable,
        id: piece.id,
      })),
  )

/** Plan a mood board: the person's pieces it picks and its moods. Nothing it can make gives the credit back. */
const plan = (deps: Deps, job: JobRow) =>
  Effect.gen(function* () {
    const wardrobe = yield* wardrobeOf(deps).pipe(Effect.mapError(unavailable))
    const planned = yield* deps.planner
      .plan({ sentence: job.prompt, wardrobe: wardrobe.map(({ wearable }) => wearable) })
      .pipe(Effect.mapError(unavailable))
    const at = yield* nowDate
    if (Option.isNone(planned))
      return yield* stored(
        deps.store.advanceJob(job.id, ['planning'], { status: 'refused', reason: 'unclear', updatedAt: at }),
      )
    const idOf = new Map(wardrobe.map(({ wearable, id }) => [wearable.ref, id]))
    yield* stored(
      deps.store.advanceJob(job.id, ['planning'], {
        status: 'arranging',
        picks: planned.value.picks.flatMap((ref) => Option.toArray(Option.fromNullishOr(idOf.get(ref)))),
        moods: planned.value.moods,
        updatedAt: at,
      }),
    )
  })

/** A sticker that will not be drawn: refused, or lost on the way. The job ends refused, so its credit goes back
 * either way; a lost answer may have been drawn and billed, but the person did not get it. */
const ended = (deps: Deps, job: JobRow, status: 'refused' | 'unknown') =>
  Effect.flatMap(nowDate, (at) => stored(deps.store.finishSticker(job.id, { status, imageId: null }, at)))

/** Put the sticker on the board as a received upload, marked Generated. */
const placeOnBoard = (deps: Deps, job: JobRow, painted: Picture) =>
  Effect.gen(function* () {
    const contentType = yield* Schema.decodeUnknownEffect(ImageType)(painted.contentType).pipe(
      Effect.mapError(unavailable),
    )
    const uploadId = yield* receivedUpload(deps.wardrobe, { contentType, bytes: painted.bytes }).pipe(
      Effect.mapError(unavailable),
    )
    const { imageId } = yield* deps.boards
      .addGeneratedImage(BoardId.make(job.boardId), { operationId: boardOperation(job, 'sticker'), uploadId })
      .pipe(Effect.mapError(unavailable))
    return imageId
  })

/** Draw the claimed sticker, key its background out and put it on the board. A drawing that does not key out cleanly
 * counts as refused. */
const drawOne = (deps: Deps, job: JobRow, sticker: StickerRow) =>
  Effect.gen(function* () {
    const key = stickerKey(job.prompt)
    const painted = yield* Effect.result(deps.painter.paint({ prompt: sticker.prompt, key }))
    if (Result.isFailure(painted))
      return yield* ended(deps, job, isOutcomeUnknown(painted.failure) ? 'unknown' : 'refused')
    const keyed = stickerOf(painted.success, key)
    if (Option.isNone(keyed)) return yield* ended(deps, job, 'refused')
    // The painted bytes live only in this delivery: a picture that cannot be stored now is lost.
    const placed = yield* Effect.result(placeOnBoard(deps, job, keyed.value))
    if (Result.isFailure(placed)) return yield* ended(deps, job, 'unknown')
    yield* stored(deps.store.finishSticker(job.id, { status: 'drawn', imageId: placed.success }, yield* nowDate))
  })

/** Whether a claim has outlived any delivery that could still finish it. */
const isStale = (sticker: StickerRow, at: Date) => at.getTime() - (sticker.startedAt?.getTime() ?? 0) > patienceMillis

/** The sticker's turn: drawn when it waits and this delivery claims it. One claimed by a delivery that died is lost;
 * one claimed by a delivery still drawing is left to it. */
const drawStep = (deps: Deps, job: JobRow, sticker: StickerRow) =>
  Effect.gen(function* () {
    const at = yield* nowDate
    if (sticker.status === 'drawing' && isStale(sticker, at)) return yield* ended(deps, job, 'unknown')
    if (sticker.status === 'waiting' && (yield* stored(deps.store.claimSticker(job.id, at))))
      yield* drawOne(deps, job, { ...sticker, status: 'drawing', startedAt: at })
  })

/** Draw the sticker once, then end the job: done when it was drawn, refused otherwise. A delivery that finds another
 * still drawing leaves the job to it. */
const draw = (deps: Deps, job: JobRow) =>
  Effect.gen(function* () {
    const found = yield* stored(deps.store.stickerOf(job.id))
    if (Option.isNone(found)) return yield* unavailable()
    yield* drawStep(deps, job, found.value)
    const sticker = yield* stored(deps.store.stickerOf(job.id))
    const status = Option.match(sticker, { onNone: () => 'waiting' as const, onSome: (row) => row.status })
    if (status === 'waiting' || status === 'drawing') return
    yield* stored(
      deps.store.advanceJob(job.id, ['drawing'], {
        status: status === 'drawn' ? 'done' : 'refused',
        reason: status === 'drawn' ? null : 'refused',
        updatedAt: yield* nowDate,
      }),
    )
  })

/** A mood board's last step: pin the pieces it picked, give the board its moods if it has none, and lay the collage
 * out with them, unless the person changed the collage since asking. */
const arrange = (deps: Deps, job: JobRow) =>
  Effect.gen(function* () {
    const boardId = BoardId.make(job.boardId)
    const picks = job.picks.map((id) => PieceId.make(id))
    const moods = job.moods.filter(isMood)
    const board = yield* deps.boards.getBoard(boardId).pipe(Effect.mapError(unavailable))
    if (picks.length > 0)
      yield* deps.boards
        .addPins(boardId, { operationId: boardOperation(job, 'pins'), pieceIds: picks })
        .pipe(Effect.mapError(unavailable))
    if (board.moods.length === 0 && moods.length > 0)
      yield* deps.boards
        .updateBoard(boardId, { operationId: boardOperation(job, 'moods'), moods })
        .pipe(Effect.mapError(unavailable))
    if (board.version === job.collageVersion)
      yield* deps.boards
        .arrangeBoard(boardId, {
          operationId: boardOperation(job, 'layout'),
          layout: 'tidy',
          add: picks.map((pieceId) => ({ _tag: 'TablePiece' as const, pieceId })),
        })
        .pipe(Effect.mapError(unavailable))
    yield* stored(deps.store.advanceJob(job.id, ['arranging'], { status: 'done', updatedAt: yield* nowDate }))
  })

/** Take the job as far as it goes now, acting for its account; a job that ended has its credit settled, by this
 * delivery or, if that settle is lost, by the next. */
export const work = Effect.fn('Styld.Generation.work')(function* (deps: Deps, jobId: string) {
  const step = stored(deps.store.jobForWork(jobId))
  const start = yield* step
  if (Option.isNone(start)) return
  const account = { accountId: start.value.accountId, via: 'assistant' as const }
  const act = <A, E>(effect: Effect.Effect<A, E, CurrentAccount>) =>
    Effect.provideService(effect, CurrentAccount, account)
  if (start.value.status === 'planning') yield* act(plan(deps, start.value))
  const planned = yield* step
  if (Option.isSome(planned) && planned.value.status === 'drawing') yield* act(draw(deps, planned.value))
  const drawn = yield* step
  if (Option.isSome(drawn) && drawn.value.status === 'arranging') yield* act(arrange(deps, drawn.value))
  const last = yield* step
  if (Option.isSome(last)) yield* settleJob(deps.holds, last.value)
})

/** Give a job up: it fails, its waiting sticker is refused, and its credit goes back. A sticker a dead delivery
 * claimed is lost; one still being drawn is left to finish. */
export const giveUp = Effect.fn('Styld.Generation.giveUp')(function* (deps: Deps, jobId: string) {
  const job = yield* stored(deps.store.jobForWork(jobId))
  if (Option.isNone(job)) return
  const at = yield* nowDate
  const before = yield* stored(deps.store.stickerOf(jobId))
  yield* stored(deps.store.giveUp(jobId, at))
  if (Option.exists(before, (sticker) => sticker.status === 'drawing' && isStale(sticker, at)))
    yield* ended(deps, job.value, 'unknown')
  const latest = yield* stored(deps.store.jobForWork(jobId))
  if (Option.isSome(latest)) yield* settleJob(deps.holds, latest.value)
})
