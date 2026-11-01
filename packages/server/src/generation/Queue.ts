import { Option } from 'effect'
import { defineQueue, type JobsOf } from '../jobs/Jobs.ts'
import { GenerationMessage } from './Parts.ts'
import type { Generations } from './Service.ts'

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
