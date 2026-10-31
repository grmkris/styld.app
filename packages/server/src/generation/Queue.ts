import type * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect, Schema } from 'effect'
import { GenerationMessage } from './Parts.ts'
import type { Generations } from './Service.ts'

/** Deliveries of one job before it fails and its unspent credits go back. */
export const generationAttempts = 4

/** Settle one generation message: taken as far as it goes, tried again while something it needs is down, or given up
 * after the last try. A body that is no job is dropped. */
export const settleGeneration = (generations: Generations['Service'], message: Cloudflare.Queues.Message) =>
  Schema.decodeUnknownEffect(GenerationMessage)(message.body).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.succeed<'ack' | 'retry'>('ack'),
      onSuccess: ({ jobId }) =>
        generations.work(jobId).pipe(
          Effect.as<'ack' | 'retry'>('ack'),
          Effect.catchCause(() =>
            message.attempts >= generationAttempts
              ? generations.giveUp(jobId).pipe(Effect.ignore, Effect.as<'ack' | 'retry'>('ack'))
              : Effect.succeed<'ack' | 'retry'>('retry'),
          ),
        ),
    }),
    Effect.flatMap((outcome) => Effect.sync(() => (outcome === 'ack' ? message.ack() : message.retry()))),
  )
