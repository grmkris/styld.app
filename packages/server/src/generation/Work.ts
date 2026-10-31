import { BoardId, BoardImageId, ImageType, Mood, OperationId, PieceId } from '@styld/protocol'
import { Effect, Option, Predicate, Result, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { Picture } from '../capture/Providers.ts'
import { receivedUpload } from '../mcp/ImageImport.ts'
import { shownImage } from '../wardrobe/Shown.ts'
import { refund } from './Generation.ts'
import { paintPrompt } from './PaintPrompt.ts'
import { holdOf, nowDate, type Parts, pictureOperation, unavailable } from './Parts.ts'
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
      const sendable = (picture?.face ?? 0) < parts.face && shown.key !== piece.originalKey
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
      return yield* stored(parts.store.updateJob(job.id, { status: 'refused', reason: 'unclear', updatedAt: at }))
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

/** Draw one claimed picture and put it on the board, then settle its credit: consumed once it is there, given back
 * when the painter refused, kept when the answer was lost (the painter may have drawn and billed it). */
const drawOne = (parts: Parts, job: JobRow, picture: PictureRow) =>
  Effect.gen(function* () {
    const hold = holdOf(job.id, picture.index)
    const painted = yield* Effect.result(
      Effect.flatMap(referencesOf(parts, job, picture), (references) =>
        parts.painter.paint({ prompt: picture.prompt, references }),
      ),
    )
    if (Result.isFailure(painted)) {
      if (Predicate.isTagged(painted.failure, 'CaptureUnavailable')) return yield* painted.failure
      const lost = Predicate.isTagged(painted.failure, 'ProviderOutcomeUnknown')
      yield* stored(
        parts.store.finishPicture(job.id, picture.index, { status: lost ? 'unknown' : 'refused', imageId: null }),
      )
      if (!lost) yield* parts.usage.settle(job.accountId, hold, 'refunded').pipe(Effect.ignore({ log: true }))
      return
    }
    const contentType = yield* Schema.decodeUnknownEffect(ImageType)(painted.success.contentType).pipe(
      Effect.mapError(unavailable),
    )
    const uploadId = yield* receivedUpload(parts.wardrobe, { contentType, bytes: painted.success.bytes }).pipe(
      Effect.mapError(unavailable),
    )
    const { imageId } = yield* parts.boards
      .addGeneratedImage(BoardId.make(job.boardId), {
        operationId: OperationId.make(pictureOperation(job.id, picture.index)),
        uploadId,
        jobId: job.id,
        model: parts.painter.model,
      })
      .pipe(Effect.mapError(unavailable))
    yield* stored(parts.store.finishPicture(job.id, picture.index, { status: 'drawn', imageId }))
    yield* parts.usage.settle(job.accountId, hold, 'consumed').pipe(Effect.ignore({ log: true }))
  })

/** One picture's turn: drawn when it waits and this delivery claims it. One claimed by a delivery that died is lost,
 * and its credit kept; one claimed by a delivery still drawing makes this one try again later. */
const drawStep = (parts: Parts, job: JobRow, picture: PictureRow) =>
  Effect.gen(function* () {
    const at = yield* nowDate
    if (picture.status === 'drawing') {
      if (at.getTime() - (picture.startedAt?.getTime() ?? 0) <= patienceMillis) return yield* unavailable()
      return yield* stored(parts.store.finishPicture(job.id, picture.index, { status: 'unknown', imageId: null }))
    }
    if (picture.status !== 'waiting' || !(yield* stored(parts.store.claimPicture(job.id, picture.index, at)))) return
    yield* drawOne(parts, job, { ...picture, status: 'drawing', startedAt: at })
  })

/** Draw each picture still waiting, once, then move the job on: refused when none was drawn. */
const draw = (parts: Parts, job: JobRow) =>
  Effect.gen(function* () {
    yield* Effect.forEach(yield* stored(parts.store.picturesOf(job.id)), (picture) => drawStep(parts, job, picture), {
      discard: true,
    })
    const drawn = (yield* stored(parts.store.picturesOf(job.id))).some(({ status }) => status === 'drawn')
    const next = !drawn ? 'refused' : job.kind === 'moodBoard' ? 'arranging' : 'done'
    yield* stored(
      parts.store.updateJob(job.id, {
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
    yield* stored(parts.store.updateJob(job.id, { status: 'done', updatedAt: yield* nowDate }))
  })

/** Take the job as far as it goes now, acting for its account. */
export const work = Effect.fn('Styld.Generation.work')(function* (parts: Parts, jobId: string) {
  const step = Effect.gen(function* () {
    const current = yield* stored(parts.store.jobForWork(jobId))
    return current
  })
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

/** The queue gave up on the job: it failed, and every credit not spent on a picture or lost on the way goes back. */
export const giveUp = Effect.fn('Styld.Generation.giveUp')(function* (parts: Parts, jobId: string) {
  const job = yield* stored(parts.store.jobForWork(jobId))
  if (Option.isNone(job) || ['done', 'refused', 'failed'].includes(job.value.status)) return
  const pictures = yield* stored(parts.store.picturesOf(jobId))
  const settled = new Set(pictures.filter(({ status }) => status !== 'waiting').map(({ index }) => index))
  yield* Effect.forEach(
    Array.from({ length: job.value.held }, (_, index) => index).filter((index) => !settled.has(index)),
    (index) => refund(parts, job.value.accountId, jobId, index, index + 1),
    { discard: true },
  )
  yield* stored(parts.store.updateJob(jobId, { status: 'failed', reason: 'unavailable', updatedAt: yield* nowDate }))
})
