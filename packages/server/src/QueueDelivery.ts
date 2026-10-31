import type * as Cloudflare from '@alchemy.run/cloudflare'
import { type ObservabilityBase, withObservability } from '@styld/observability'
import { Option, Schema } from 'effect'
import { GenerationMessage } from './generation/Parts.ts'
import { CheckMessage } from './safety/Checks.ts'
import { StylistTurn } from './stylist/Queue.ts'

/** The queues the API Worker consumes. */
export type Queue = 'pieces' | 'checks' | 'generation' | 'stylist'

/** The job a delivery carries, by the id its own operations record: a generation job, a Styld turn or a checked
 * target. A piece's work keeps the queue's own message id. */
const jobOf = (queue: Queue, body: unknown): Option.Option<string> => {
  switch (queue) {
    case 'generation':
      return Option.map(Schema.decodeUnknownOption(GenerationMessage)(body), ({ jobId }) => jobId)
    case 'stylist':
      return Option.map(Schema.decodeUnknownOption(StylistTurn)(body), ({ stylistTurnOf }) => stylistTurnOf)
    case 'checks':
      return Option.map(Schema.decodeUnknownOption(CheckMessage)(body), ({ target }) => `${target.kind}:${target.id}`)
    case 'pieces':
      return Option.none()
  }
}

/** One queue delivery as its own span, with the release, the queue, the job it carries and its attempt on the span
 * and on every log it writes, as HTTP requests have theirs. */
export const asDelivery = (base: ObservabilityBase, queue: Queue, message: Cloudflare.Queues.Message) =>
  withObservability('styld.queue', {
    ...base,
    kind: `queue.${queue}`,
    jobId: Option.getOrElse(jobOf(queue, message.body), () => message.id),
    attempt: message.attempts,
  })
