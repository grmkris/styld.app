import { BoardId, BoardImageId, ImageType, Mood, OperationId, PieceId } from '@styld/protocol'
import { Effect, Option, Predicate, Result, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { Picture } from '../capture/Providers.ts'
import { receivedUpload } from '../mcp/ImageImport.ts'
import { shownImage } from '../wardrobe/Shown.ts'
import { paintPrompt } from './PaintPrompt.ts'
import { holdOf, nowDate, type Parts, pictureOperation, refund, unavailable } from './Parts.ts'
import type { Wearable } from './Planner.ts'
import type { JobRow, PictureRow } from './Store.ts'

// Taking a job further, one delivery of the generation queue at a time: plan a mood board, draw each picture once, then
// lay the board out. Every step reads where the job stands, so a redelivery picks up where the last one stopped.

/** A claimed drawing older than the painter's 90 s patience, plus storing it, belongs to a delivery that died. */
const patienceMillis = 3 * 60 * 1000

/** The most of the person's pieces a plan reads. */
const wardrobeShown = 40

const stored = <A, E>(effect: Effect.Effect<A, E>) => Effect.mapError(effect, unavailable)
const isMood = Schema.is(Mood)
const isPictureType = (type: string): type is Picture['contentType'] =>
  type === 'image/png' || type === 'image/jpeg' || type === 'image/webp'

/** The type a stored picture was written as: clean pictures are PNG, cut-outs WebP or PNG by their name. */
const contentTypeOf = (key: string) =>
  key.endsWith('.webp') ? 'image/webp' : key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'

/** The person's ready pieces and how each may be shown to the painter: its clean picture or cut-out, never its photo
 * and never one with a face. */
const wardrobeOf = (parts: Parts, accountId: string) =>
  Effect.gen(function* () {
    const pieces = (yield* stored(parts.wardrobeStore.listPieces(accountId))).filter(({ status }) => status === 'ready')
    const pictures = new Map(
      (yield* stored(parts.wardrobeStore.picturesOf(accountId))).map((picture) => [picture.pieceId, picture]),
    )
    return pieces.slice(0, wardrobeShown).map((piece, at) => {
      const picture = pictures.get(piece.id)
      const shown = shownImage(piece, picture)
      // A picture not yet judged for a face is not sent: only a known score under the limit is.
      const face = picture?.face ?? null
      const sendable = face !== null && face < parts.face && shown.key !== piece.originalKey
      return {
        wearable: {
          ref: `p${at + 1}`,
          name: piece.name ?? piece.subcategory ?? piece.category,
          category: piece.category,
          colours: piece.colours,
        } satisfies Wearable,
        id: piece.id,
        reference: sendable ? Option.some(shown) : Option.none(),
      }
    })
  })

/** Plan a mood board: its pictures, the pieces it picks and its moods. Credits held beyond the plan go back. */
const plan = (parts: Parts, job: JobRow) =>
  Effect.gen(function* () {
    const wardrobe = yield* wardrobeOf(parts, job.accountId)
    const planned = yield* parts.planner
      .plan({ sentence: job.prompt, wardrobe: wardrobe.map(({ wearable }) => wearable), most: job.held })
      .pipe(Effect.mapError(unavailable))
    const at = yield* nowDate
    const prompts = Option.map(planned, ({ pictures }) => pictures.map(({ prompt }) => prompt))
    const safe = Option.isSome(prompts)
      ? (yield* parts.judge.judge({ texts: prompts.value, pictures: [] }).pipe(Effect.mapError(unavailable))).state !==
        'failed'
      : false
    if (Option.isNone(planned) || !safe) {
      yield* refund(parts, job.accountId, job.id, 0, job.held)
      return yield* stored(
        parts.store.advanceJob(job.id, ['planning'], { status: 'refused', reason: 'unclear', updatedAt: at }),
      )
    }
    const idOf = new Map(wardrobe.map(({ wearable, id }) => [wearable.ref, id]))
    const pictures: ReadonlyArray<PictureRow> = planned.value.pictures.map(({ prompt, pieces }, index) => ({
      jobId: job.id,
      index,
      prompt: paintPrompt(prompt, pieces.length > 0),
      references: pieces.flatMap((ref) => Option.toArray(Option.fromNullishOr(idOf.get(ref)))),
      status: 'waiting',
      imageId: null,
      startedAt: null,
    }))
    yield* refund(parts, job.accountId, job.id, pictures.length, job.held)
    yield* stored(
      parts.store.planned(job.id, pictures, {
        status: 'drawing',
        held: pictures.length,
        picks: planned.value.picks.flatMap((ref) => Option.toArray(Option.fromNullishOr(idOf.get(ref)))),
        moods: planned.value.moods,
        updatedAt: at,
      }),
    )
  })

/** The pictures a picture is drawn from, read from the bucket; a piece gone or not sendable is left out. */
const referencesOf = (parts: Parts, job: JobRow, picture: PictureRow) =>
  Effect.gen(function* () {
    if (picture.references.length === 0) return []
    const sendable = new Map(
      (yield* wardrobeOf(parts, job.accountId)).map(({ id, reference }) => [id, reference] as const),
    )
    const keys = picture.references.flatMap((id) => Option.toArray(sendable.get(id) ?? Option.none()))
    return yield* Effect.forEach(keys, ({ key }) =>
      Effect.tryPromise({ try: () => parts.bucket.get(key), catch: unavailable }).pipe(
        Effect.flatMap((object) =>
          object === null
            ? Effect.succeed(Option.none<Picture>())
            : Effect.map(
                Effect.tryPromise({ try: () => object.arrayBuffer(), catch: unavailable }),
                (buffer): Option.Option<Picture> =>
                  Option.map(Option.liftPredicate(contentTypeOf(key), isPictureType), (type) => ({
                    bytes: new Uint8Array(buffer),
                    contentType: type,
                  })),
              ),
        ),
      ),
    ).pipe(Effect.map((found) => found.flatMap(Option.toArray)))
  })

/** A picture that will not be drawn: refused, or lost on the way. Its credit goes back either way; a lost answer may
 * have been drawn and billed, but the person did not get it. */
const ended = (parts: Parts, job: JobRow, index: number, status: 'refused' | 'unknown') =>
  Effect.gen(function* () {
    yield* stored(parts.store.finishPicture(job.id, index, { status, imageId: null }, yield* nowDate))
    yield* parts.usage.settle(job.accountId, holdOf(job.id, index), 'refunded').pipe(Effect.ignore({ log: true }))
  })

/** Put the painted picture on the board as a received upload, marked Generated. */
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
        jobId: job.id,
        model: parts.painter.model,
      })
      .pipe(Effect.mapError(unavailable))
    return imageId
  })

/** Draw one claimed picture and put it on the board, then settle its credit: consumed once it is there, given back
 * otherwise. A claim whose painter was never reached is put back for the next delivery. */
const drawOne = (parts: Parts, job: JobRow, picture: PictureRow) =>
  Effect.gen(function* () {
    const references = yield* referencesOf(parts, job, picture).pipe(
      Effect.tapError(() => stored(parts.store.releasePicture(job.id, picture.index))),
    )
    const painted = yield* Effect.result(parts.painter.paint({ prompt: picture.prompt, references }))
    if (Result.isFailure(painted))
      return yield* ended(
        parts,
        job,
        picture.index,
        Predicate.isTagged(painted.failure, 'ProviderOutcomeUnknown') ? 'unknown' : 'refused',
      )
    // The painted bytes live only in this delivery: a picture that cannot be stored now is lost.
    const placed = yield* Effect.result(placeOnBoard(parts, job, picture.index, painted.success))
    if (Result.isFailure(placed)) return yield* ended(parts, job, picture.index, 'unknown')
    yield* stored(
      parts.store.finishPicture(job.id, picture.index, { status: 'drawn', imageId: placed.success }, yield* nowDate),
    )
    yield* parts.usage
      .settle(job.accountId, holdOf(job.id, picture.index), 'consumed')
      .pipe(Effect.ignore({ log: true }))
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

/** Draw each picture still waiting, once, then move the job on: refused when none was drawn. A delivery that finds
 * another still drawing leaves the job to it. */
const draw = (parts: Parts, job: JobRow) =>
  Effect.gen(function* () {
    for (const picture of yield* stored(parts.store.picturesOf(job.id)))
      if ((yield* drawStep(parts, job, picture)) === 'busy') return
    const pictures = yield* stored(parts.store.picturesOf(job.id))
    if (pictures.some(({ status }) => status === 'waiting' || status === 'drawing')) return
    const drawn = pictures.some(({ status }) => status === 'drawn')
    const next = !drawn ? 'refused' : job.kind === 'moodBoard' ? 'arranging' : 'done'
    yield* stored(
      parts.store.advanceJob(job.id, ['drawing'], {
        status: next,
        reason: next === 'refused' ? 'refused' : null,
        updatedAt: yield* nowDate,
      }),
    )
  })

/** A mood board's last step: pin the pieces it picked, give the board its moods if it has none, and lay the collage
 * out with the new pictures, unless the person changed the collage since asking. */
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
      yield* parts.boards.updateBoard(boardId, { moods }).pipe(Effect.mapError(unavailable))
    if (board.version === job.collageVersion) {
      const drawn = (yield* stored(parts.store.picturesOf(job.id))).flatMap(({ imageId }) =>
        imageId === null ? [] : [{ _tag: 'TablePicture' as const, imageId: BoardImageId.make(imageId) }],
      )
      yield* parts.boards
        .arrangeBoard(boardId, {
          operationId: OperationId.make(`gen-${job.id}-layout`),
          layout: 'tidy',
          add: [...drawn, ...picks.map((pieceId) => ({ _tag: 'TablePiece' as const, pieceId }))],
        })
        .pipe(Effect.mapError(unavailable))
    }
    yield* stored(parts.store.advanceJob(job.id, ['arranging'], { status: 'done', updatedAt: yield* nowDate }))
  })

/** Take the job as far as it goes now, acting for its account. */
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
})

/** Give a job up: it fails, its waiting pictures are refused, and every credit not spent goes back. A picture a dead
 * delivery claimed is lost; one still being drawn is left to finish, and settles itself. */
export const giveUp = Effect.fn('Styld.Generation.giveUp')(function* (parts: Parts, jobId: string) {
  const job = yield* stored(parts.store.jobForWork(jobId))
  if (Option.isNone(job)) return
  const at = yield* nowDate
  const before = yield* stored(parts.store.picturesOf(jobId))
  const [failed, refused] = yield* stored(parts.store.giveUp(jobId, at))
  if (failed.length === 0) return
  const held = failed[0]?.held ?? 0
  // A job given up before its plan has no pictures yet: all its credits go back.
  const back =
    before.length === 0 ? Array.from({ length: held }, (_, index) => index) : refused.map(({ index }) => index)
  yield* Effect.forEach(back, (index) => refund(parts, job.value.accountId, jobId, index, index + 1), {
    discard: true,
  })
  yield* Effect.forEach(
    before.filter((picture) => picture.status === 'drawing' && isStale(picture, at)),
    (picture) => ended(parts, job.value, picture.index, 'unknown'),
    { discard: true },
  )
})
