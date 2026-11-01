import { isOutcomeUnknown } from '../providers/Errors.ts'
import { BoardId, ImageType, Mood, OperationId, PieceId } from '@styld/protocol'
import { Effect, Option, Result, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { Picture } from '../capture/Providers.ts'
import { receivedUpload } from '../mcp/ImageImport.ts'
import { stickerKey } from './PaintPrompt.ts'
import { type Parts, pictureOperation, settleJob, unavailable } from './Parts.ts'
import { nowDate } from '../kernel/Db.ts'
import type { Wearable } from './Planner.ts'
import { stickerOf } from './Sticker.ts'
import type { JobRow, PictureRow } from './Store.ts'

// Taking a job further, one delivery of the generation queue at a time: draw a sticker once, or plan a mood board from
// the person's pieces and lay the board out. Every step reads where the job stands, so a redelivery picks up where the
// last one stopped.

/** A claimed drawing older than the painter's 90 s patience, plus storing it, belongs to a delivery that died. */
const patienceMillis = 3 * 60 * 1000

/** The most of the person's pieces a plan reads. */
const planReads = 40

const stored = <A, E>(effect: Effect.Effect<A, E>) => Effect.mapError(effect, unavailable)
const isMood = Schema.is(Mood)

/** The person's ready pieces as the plan reads them: a short reference each, never an id, photo or note. */
const wardrobeOf = (parts: Parts, accountId: string) =>
  Effect.map(stored(parts.wardrobeStore.listPieces(accountId)), (pieces) =>
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
const plan = (parts: Parts, job: JobRow) =>
  Effect.gen(function* () {
    const wardrobe = yield* wardrobeOf(parts, job.accountId)
    const planned = yield* parts.planner
      .plan({ sentence: job.prompt, wardrobe: wardrobe.map(({ wearable }) => wearable) })
      .pipe(Effect.mapError(unavailable))
    const at = yield* nowDate
    if (Option.isNone(planned))
      return yield* stored(
        parts.store.advanceJob(job.id, ['planning'], { status: 'refused', reason: 'unclear', updatedAt: at }),
      )
    const idOf = new Map(wardrobe.map(({ wearable, id }) => [wearable.ref, id]))
    yield* stored(
      parts.store.advanceJob(job.id, ['planning'], {
        status: 'arranging',
        picks: planned.value.picks.flatMap((ref) => Option.toArray(Option.fromNullishOr(idOf.get(ref)))),
        moods: planned.value.moods,
        updatedAt: at,
      }),
    )
  })

/** A picture that will not be drawn: refused, or lost on the way. The job ends refused, so its credit goes back
 * either way; a lost answer may have been drawn and billed, but the person did not get it. */
const ended = (parts: Parts, job: JobRow, index: number, status: 'refused' | 'unknown') =>
  Effect.gen(function* () {
    yield* stored(parts.store.finishPicture(job.id, index, { status, imageId: null }, yield* nowDate))
  })

/** Put the sticker on the board as a received upload, marked Generated. */
const placeOnBoard = (parts: Parts, job: JobRow, index: number, painted: Picture) =>
  Effect.gen(function* () {
    const contentType = yield* Schema.decodeUnknownEffect(ImageType)(painted.contentType).pipe(
      Effect.mapError(unavailable),
    )
    const uploadId = yield* receivedUpload(parts.wardrobe, { contentType, bytes: painted.bytes }).pipe(
      Effect.mapError(unavailable),
    )
    const { imageId } = yield* parts.boards
      .addGeneratedImage(BoardId.make(job.boardId), {
        operationId: OperationId.make(pictureOperation(job.id, index)),
        uploadId,
      })
      .pipe(Effect.mapError(unavailable))
    return imageId
  })

/** Draw one claimed sticker, key its background out and put it on the board. A drawing that does not key out cleanly
 * counts as refused. */
const drawOne = (parts: Parts, job: JobRow, picture: PictureRow) =>
  Effect.gen(function* () {
    const key = stickerKey(job.prompt)
    const painted = yield* Effect.result(parts.painter.paint({ prompt: picture.prompt, key }))
    if (Result.isFailure(painted))
      return yield* ended(parts, job, picture.index, isOutcomeUnknown(painted.failure) ? 'unknown' : 'refused')
    const sticker = stickerOf(painted.success, key)
    if (Option.isNone(sticker)) return yield* ended(parts, job, picture.index, 'refused')
    // The painted bytes live only in this delivery: a picture that cannot be stored now is lost.
    const placed = yield* Effect.result(placeOnBoard(parts, job, picture.index, sticker.value))
    if (Result.isFailure(placed)) return yield* ended(parts, job, picture.index, 'unknown')
    yield* stored(
      parts.store.finishPicture(job.id, picture.index, { status: 'drawn', imageId: placed.success }, yield* nowDate),
    )
  })

/** Whether a claim has outlived any delivery that could still finish it. */
const isStale = (picture: PictureRow, at: Date) => at.getTime() - (picture.startedAt?.getTime() ?? 0) > patienceMillis

/** One picture's turn: drawn when it waits and this delivery claims it. One claimed by a delivery that died is lost;
 * one claimed by a delivery still drawing is left to it, and this delivery steps aside. */
const drawStep = (parts: Parts, job: JobRow, picture: PictureRow) =>
  Effect.gen(function* () {
    const at = yield* nowDate
    if (picture.status === 'drawing') {
      if (!isStale(picture, at)) return 'busy' as const
      yield* ended(parts, job, picture.index, 'unknown')
      return 'done' as const
    }
    if (picture.status === 'waiting' && (yield* stored(parts.store.claimPicture(job.id, picture.index, at))))
      yield* drawOne(parts, job, { ...picture, status: 'drawing', startedAt: at })
    return 'done' as const
  })

/** Draw the sticker still waiting, once, then end the job: refused when it was not drawn. A delivery that finds
 * another still drawing leaves the job to it. */
const draw = (parts: Parts, job: JobRow) =>
  Effect.gen(function* () {
    for (const picture of yield* stored(parts.store.picturesOf(job.id)))
      if ((yield* drawStep(parts, job, picture)) === 'busy') return
    const pictures = yield* stored(parts.store.picturesOf(job.id))
    if (pictures.some(({ status }) => status === 'waiting' || status === 'drawing')) return
    const next = pictures.some(({ status }) => status === 'drawn') ? 'done' : 'refused'
    yield* stored(
      parts.store.advanceJob(job.id, ['drawing'], {
        status: next,
        reason: next === 'refused' ? 'refused' : null,
        updatedAt: yield* nowDate,
      }),
    )
  })

/** A mood board's last step: pin the pieces it picked, give the board its moods if it has none, and lay the collage
 * out with them, unless the person changed the collage since asking. */
const arrange = (parts: Parts, job: JobRow) =>
  Effect.gen(function* () {
    const boardId = BoardId.make(job.boardId)
    const picks = job.picks.map((id) => PieceId.make(id))
    const moods = job.moods.filter(isMood)
    const board = yield* parts.boards.getBoard(boardId).pipe(Effect.mapError(unavailable))
    if (picks.length > 0)
      yield* parts.boards
        .addPins(boardId, { operationId: OperationId.make(`gen-${job.id}-pins`), pieceIds: picks })
        .pipe(Effect.mapError(unavailable))
    if (board.moods.length === 0 && moods.length > 0)
      yield* parts.boards
        .updateBoard(boardId, { operationId: OperationId.make(`gen-${job.id}-moods`), moods })
        .pipe(Effect.mapError(unavailable))
    if (board.version === job.collageVersion)
      yield* parts.boards
        .arrangeBoard(boardId, {
          operationId: OperationId.make(`gen-${job.id}-layout`),
          layout: 'tidy',
          add: picks.map((pieceId) => ({ _tag: 'TablePiece' as const, pieceId })),
        })
        .pipe(Effect.mapError(unavailable))
    yield* stored(parts.store.advanceJob(job.id, ['arranging'], { status: 'done', updatedAt: yield* nowDate }))
  })

/** Take the job as far as it goes now, acting for its account; a job that ended has its credit settled, by this
 * delivery or, if that settle is lost, by the next. */
export const work = Effect.fn('Styld.Generation.work')(function* (parts: Parts, jobId: string) {
  const step = stored(parts.store.jobForWork(jobId))
  const start = yield* step
  if (Option.isNone(start)) return
  const account = { accountId: start.value.accountId, via: 'assistant' as const }
  const act = <A, E>(effect: Effect.Effect<A, E, CurrentAccount>) =>
    Effect.provideService(effect, CurrentAccount, account)
  if (start.value.status === 'planning') yield* plan(parts, start.value)
  const planned = yield* step
  if (Option.isSome(planned) && planned.value.status === 'drawing') yield* act(draw(parts, planned.value))
  const drawn = yield* step
  if (Option.isSome(drawn) && drawn.value.status === 'arranging') yield* act(arrange(parts, drawn.value))
  const last = yield* step
  if (Option.isSome(last)) yield* stored(settleJob(parts, last.value))
})

/** Give a job up: it fails, its waiting sticker is refused, and its credit goes back. A sticker a dead delivery claimed
 * is lost; one still being drawn is left to finish. */
export const giveUp = Effect.fn('Styld.Generation.giveUp')(function* (parts: Parts, jobId: string) {
  const job = yield* stored(parts.store.jobForWork(jobId))
  if (Option.isNone(job)) return
  const at = yield* nowDate
  const before = yield* stored(parts.store.picturesOf(jobId))
  yield* stored(parts.store.giveUp(jobId, at))
  yield* Effect.forEach(
    before.filter((picture) => picture.status === 'drawing' && isStale(picture, at)),
    (picture) => ended(parts, job.value, picture.index, 'unknown'),
    { discard: true },
  )
  const latest = yield* stored(parts.store.jobForWork(jobId))
  if (Option.isSome(latest)) yield* stored(settleJob(parts, latest.value))
})
