import { Effect, Option } from 'effect'
import { defineQueue, type JobsOf } from '../jobs/Jobs.ts'
import { CheckMessage, type Checks } from './Checks.ts'

/** Checks of what people make public: tried five times while the model does not answer. A check given up stays
 * pending, hidden from others, until the content changes again or the sweep asks again. */
export const checkJobQueue = defineQueue({
  name: 'checks',
  body: CheckMessage,
  attempts: 5,
  batchSize: 10,
  retryDelay: '30 seconds',
  jobOf: ({ target }) => Option.some(`${target.kind}:${target.id}`),
})

export const checkJobs = (checks: Checks['Service']): JobsOf<typeof CheckMessage.Type> => ({
  CheckContent: { run: ({ target }) => checks.checkNow(target, 'fail'), giveUp: () => Effect.void },
})
