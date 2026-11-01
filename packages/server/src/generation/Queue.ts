import { Context, Layer, Option, Schema } from 'effect'
import { defineQueue, type JobsOf } from '../jobs/Jobs.ts'
import type { Generations } from './Service.ts'

/** What the generation queue carries: a job to take further. */
export const GenerationMessage = Schema.TaggedUnion({ TakeJob: { jobId: Schema.String } })
export type GenerationMessage = typeof GenerationMessage.Type

/** The generation queue's producer, as the Worker binds it. */
export class GenerationQueue extends Context.Service<
  GenerationQueue,
  { send(message: GenerationMessage): Promise<unknown> }
>()('@styld/server/generation/GenerationQueue') {
  static readonly layer = (queue: GenerationQueue['Service']) => Layer.succeed(this, queue)
}

/** Stickers and mood boards: a job is taken as far as it goes on each delivery, and given up after its fourth, its
 * credit back. */
export const generationJobQueue = defineQueue({
  name: 'generation',
  body: GenerationMessage,
  attempts: 4,
  batchSize: 4,
  retryDelay: '20 seconds',
  jobOf: ({ jobId }) => Option.some(jobId),
})

export const generationJobs = (generations: Generations['Service']): JobsOf<typeof GenerationMessage.Type> => ({
  TakeJob: { run: ({ jobId }) => generations.work(jobId), giveUp: ({ jobId }) => generations.giveUp(jobId) },
})
