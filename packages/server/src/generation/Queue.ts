import { Context, Layer, Match, Option, Schema } from 'effect'
import { defineQueue, type JobsOf } from '../jobs/Jobs.ts'
import type { Generations } from './Service.ts'
import type { TryOns } from './TryOn.ts'

/** What the generation queue carries: a sticker or mood board job to take further, or a try-on. */
export const GenerationMessage = Schema.TaggedUnion({
  TakeJob: { jobId: Schema.String },
  TakeTryOn: { tryOnId: Schema.String },
})
export type GenerationMessage = typeof GenerationMessage.Type

/** The generation queue's producer, as the Worker binds it. */
export class GenerationQueue extends Context.Service<
  GenerationQueue,
  { send(message: GenerationMessage): Promise<unknown> }
>()('@styld/server/generation/GenerationQueue') {
  static readonly layer = (queue: GenerationQueue['Service']) => Layer.succeed(this, queue)
}

/** Stickers, mood boards and try-ons: each is taken as far as it goes on each delivery, and given up after its fourth,
 * its credits back. */
export const generationJobQueue = defineQueue({
  name: 'generation',
  body: GenerationMessage,
  attempts: 4,
  batchSize: 4,
  retryDelay: '20 seconds',
  jobOf: (message) =>
    Option.some(Match.valueTags(message, { TakeJob: ({ jobId }) => jobId, TakeTryOn: ({ tryOnId }) => tryOnId })),
})

export const generationJobs = (
  generations: Generations['Service'],
  tryOns: TryOns['Service'],
): JobsOf<typeof GenerationMessage.Type> => ({
  TakeJob: { run: ({ jobId }) => generations.work(jobId), giveUp: ({ jobId }) => generations.giveUp(jobId) },
  TakeTryOn: { run: ({ tryOnId }) => tryOns.work(tryOnId), giveUp: ({ tryOnId }) => tryOns.giveUp(tryOnId) },
})
