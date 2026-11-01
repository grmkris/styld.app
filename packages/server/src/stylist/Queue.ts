import { Option, Schema } from 'effect'
import { defineQueue, type JobsOf } from '../jobs/Jobs.ts'
import type { StylistService } from './Service.ts'

/** Queue message: write Styld's reply to a message. */
export const StylistTurn = Schema.TaggedUnion({ WriteReply: { turnId: Schema.String, accountId: Schema.String } })
export type StylistTurn = typeof StylistTurn.Type

/** Styld's replies, one at a time: a reply that does not come after three tries shows as failed, its credit back. */
export const stylistJobQueue = defineQueue({
  name: 'stylist',
  body: StylistTurn,
  attempts: 3,
  batchSize: 1,
  retryDelay: '5 seconds',
  jobOf: ({ turnId }) => Option.some(turnId),
})

export const stylistJobs = (
  stylist: Pick<StylistService, 'processTurn' | 'failTurn'>,
): JobsOf<typeof StylistTurn.Type> => ({
  WriteReply: {
    run: ({ accountId, turnId }) => stylist.processTurn(accountId, turnId),
    giveUp: ({ accountId, turnId }) => stylist.failTurn(accountId, turnId),
  },
})
