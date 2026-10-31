import { CaptureUnavailable, Generation } from '@styld/protocol'
import { DateTime, Effect, Schema } from 'effect'
import type { Boards } from '../boards/Boards.ts'
import type { Usage } from '../capture/Usage.ts'
import type { ContentJudge } from '../safety/Judge.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import type { makeStore } from '../wardrobe/Store.ts'
import type { MoodPlanner } from './Planner.ts'
import type { PicturePainter } from './Painter.ts'
import type { JobRow, makeGenerationStore, PictureRow } from './Store.ts'

/** What the generation queue carries: a job to take further. */
export const GenerationMessage = Schema.Struct({ jobId: Schema.String })
export type GenerationMessage = typeof GenerationMessage.Type

/** Everything a generation reads and writes, and the services it acts through for the job's account. */
export interface Parts {
  readonly store: ReturnType<typeof makeGenerationStore>
  readonly wardrobeStore: ReturnType<typeof makeStore>
  readonly bucket: { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> }
  readonly queue: { send(message: GenerationMessage): Promise<unknown> }
  readonly boards: Boards['Service']
  readonly wardrobe: Wardrobe['Service']
  readonly usage: Usage['Service']
  readonly judge: ContentJudge['Service']
  readonly planner: MoodPlanner['Service']
  readonly painter: PicturePainter['Service']
  /** A picture whose face score reaches this is never sent to the painter. */
  readonly face: number
  readonly newId: () => Effect.Effect<string, CaptureUnavailable>
  readonly digest: (text: string) => Effect.Effect<string, CaptureUnavailable>
}

export const unavailable = () => CaptureUnavailable.make({})
export const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)

/** A picture's credit in the Wallet: one per picture, its first and only attempt. */
export const holdOf = (jobId: string, index: number) => `gen/${jobId}/${index}/0`

/** The operation a picture's place on the board is written under, so a redelivery answers the same picture. */
export const pictureOperation = (jobId: string, index: number) => `gen-${jobId}-${index}`

export const send = (parts: Parts, jobId: string) =>
  Effect.tryPromise({ try: () => parts.queue.send({ jobId }), catch: unavailable }).pipe(Effect.asVoid)

/** A job as its owner reads it, decoded against the protocol so a stored row that drifted never leaves. */
export const view = (job: JobRow, pictures: ReadonlyArray<PictureRow>) =>
  Schema.decodeUnknownEffect(Generation)({
    id: job.id,
    boardId: job.boardId,
    kind: job.kind,
    status: job.status,
    reason: job.reason,
    pictures: pictures.map(({ index, status, imageId }) => ({ index, status, imageId })),
    createdAt: job.createdAt.toISOString(),
  }).pipe(Effect.mapError(unavailable))
