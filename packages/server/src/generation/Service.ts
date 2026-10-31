import { CaptureUnavailable } from '@styld/protocol'
import { Context, DateTime, Duration, Effect } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import type { Boards } from '../boards/Boards.ts'
import { CaptureConfig } from '../capture/Policy.ts'
import { Usage } from '../capture/Usage.ts'
import { ContentJudge } from '../safety/Judge.ts'
import { makeStore } from '../wardrobe/Store.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { generations } from './Generation.ts'
import { MoodPlanner } from './Planner.ts'
import { PicturePainter } from './Painter.ts'
import { type Parts, send } from './Parts.ts'
import { makeGenerationStore } from './Store.ts'
import { giveUp, work } from './Work.ts'

/** What generation is built on: the database, the bucket the pieces' pictures are read from, its queue, and the board
 * and wardrobe services it acts through. */
export interface GenerationBindings {
  readonly database: Parameters<typeof makeGenerationStore>[0]
  readonly bucket: Parts['bucket']
  readonly queue: Parts['queue']
  readonly boards: Boards['Service']
  readonly wardrobe: Wardrobe['Service']
}

const make = (parts: Parts) => ({
  ...generations(parts),
  /** Take a job further; the queue calls it for each delivery. */
  work: (jobId: string) => work(parts, jobId),
  /** The queue's last try failed: the job fails and its unspent credits go back. */
  giveUp: (jobId: string) => giveUp(parts, jobId),
  /** The schedule's sweep: jobs stalled past a drawing's patience go to the queue again, which settles them. */
  sweep: Effect.fn('Styld.Generation.sweep')(function* () {
    const before = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, sweepPatience))
    const stalled = yield* parts.store.stalledJobs(before, sweepBatch).pipe(Effect.mapError(unavailable))
    yield* Effect.forEach(stalled, (jobId) => send(parts, jobId), { discard: true })
    return stalled.length
  }),
})

const unavailable = () => CaptureUnavailable.make({})

/** A job untouched this long lost its delivery: a drawing takes 90 s at most. */
const sweepPatience = Duration.minutes(5)
const sweepBatch = 50

/** Generated pictures and mood boards for boards (M7). */
export class Generations extends Context.Service<Generations, ReturnType<typeof make>>()('@styld/server/Generations') {}

export const makeGenerations = (bindings: GenerationBindings) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const encoder = new TextEncoder()
    return Generations.of(
      make({
        store: makeGenerationStore(bindings.database),
        wardrobeStore: makeStore(bindings.database),
        bucket: bindings.bucket,
        queue: bindings.queue,
        boards: bindings.boards,
        wardrobe: bindings.wardrobe,
        usage: yield* Usage,
        judge: yield* ContentJudge,
        planner: yield* MoodPlanner,
        painter: yield* PicturePainter,
        face: (yield* CaptureConfig).pictures.face,
        newId: () =>
          Effect.map(crypto.randomBytes(16), (bytes) => `gj_${Base64Url.encode(bytes)}`).pipe(
            Effect.mapError(unavailable),
          ),
        digest: (text) =>
          Effect.map(crypto.digest('SHA-256', encoder.encode(text)), Base64Url.encode).pipe(
            Effect.mapError(unavailable),
          ),
      }),
    )
  })
