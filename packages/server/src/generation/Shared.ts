import { Unavailable, Generation } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import type { Boards } from '../boards/Boards.ts'
import type { Pacing } from '../kernel/Pacing.ts'
import type { StoreUnavailable } from '../kernel/Db.ts'
import { type Ending, Holds, holdId } from '../usage/Holds.ts'
import type { ContentJudge } from '../safety/Judge.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import type { MoodPlanner } from './Planner.ts'
import type { PicturePainter } from './Painter.ts'
import { GenerationQueue } from './Queue.ts'
import type { GenerationStore, JobRow, StickerRow } from './Store.ts'

// What the generation operations share: the services they act through, a job's hold, its queue message, how its
// owner reads it and how its status settles its credit. Every operation yields the services it uses; the
// `Generations` layer provides them once (`Service.ts`).

/** The services every generation operation acts through, provided once by the `Generations` layer. */
export type GenerationServices =
  | GenerationStore
  | GenerationQueue
  | Boards
  | Wardrobe
  | Holds
  | Pacing
  | ContentJudge
  | MoodPlanner
  | PicturePainter

export const unavailable = () => Unavailable.make({})
export const stored = <A, R>(effect: Effect.Effect<A, StoreUnavailable, R>) => Effect.mapError(effect, unavailable)

/** A job's credit in the Wallet: one per ask, its first and only attempt. */
export const jobHold = (jobId: string) => holdId('generation', jobId, 0)

/** Hand a job to the queue. */
export const send = (jobId: string) =>
  Effect.flatMap(GenerationQueue, (queue) =>
    Effect.tryPromise({ try: () => queue.send({ _tag: 'TakeJob', jobId }), catch: unavailable }),
  ).pipe(Effect.asVoid)

/** A job as its owner reads it, decoded against the protocol so a stored row that drifted never leaves. */
export const view = (job: JobRow, sticker: Option.Option<StickerRow>) =>
  Schema.decodeUnknownEffect(Generation)({
    id: job.id,
    boardId: job.boardId,
    kind: job.kind,
    status: job.status,
    reason: job.reason,
    sticker: Option.getOrNull(Option.map(sticker, ({ status, imageId }) => ({ status, imageId }))),
    createdAt: job.createdAt.toISOString(),
  }).pipe(Effect.mapError(unavailable))

/** How a job that ended settles its credit: spent once its sticker or board is there, given back otherwise. */
const endingOf = (status: JobRow['status']): Option.Option<Ending> =>
  status === 'done'
    ? Option.some('succeeded')
    : status === 'refused' || status === 'failed'
      ? Option.some('failed')
      : Option.none()

/** Settle a job's credit by how it ended; the first settlement stands, so a later delivery may settle it again. */
export const settleJob = (job: Pick<JobRow, 'id' | 'accountId' | 'status'>) =>
  Option.match(endingOf(job.status), {
    onNone: () => Effect.void,
    onSome: (ending) => Effect.flatMap(Holds, (holds) => holds.settle(job.accountId, jobHold(job.id), ending)),
  })
