import type * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect, Schema } from 'effect'
import { CheckMessage, type Checks } from './Checks.ts'

/** Deliveries of one check before it stays pending: a model down for longer leaves the content hidden until it
 * changes again. */
export const checkAttempts = 5

/** Settle one check message once: done, or tried again later while the model does not answer. A body that is no
 * check is dropped. */
export const settleCheck = (checks: Checks['Service'], message: Cloudflare.Queues.Message) =>
  Schema.decodeUnknownEffect(CheckMessage)(message.body).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.succeed<'ack' | 'retry'>('ack'),
      onSuccess: ({ target }) =>
        checks.checkNow(target, 'fail').pipe(
          Effect.as<'ack' | 'retry'>('ack'),
          Effect.catchCause(() => Effect.succeed<'ack' | 'retry'>(message.attempts >= checkAttempts ? 'ack' : 'retry')),
        ),
    }),
    Effect.flatMap((outcome) => Effect.sync(() => (outcome === 'ack' ? message.ack() : message.retry()))),
  )
