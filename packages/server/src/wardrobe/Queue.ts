import type * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect, Schema } from 'effect'
import type { AccountLifecycle } from '../AccountLifecycle.ts'
import type { Captures } from '../capture/Service.ts'
import { WorkMessage } from './Processing.ts'
import type { Wardrobe } from './Wardrobe.ts'

/** Delivery attempts before a piece shows as failed; a deletion is retried as many times. */
export const processingAttempts = 3

type Outcome = 'ack' | 'retry'

/** Settle one queue message exactly once: done, retried later, or after the last attempt marked
 * failed. A body that is no known message can never succeed, so it is dropped. */
export const settleMessage = (
  services: {
    readonly wardrobe: Wardrobe['Service']
    readonly lifecycle: AccountLifecycle['Service']
    readonly captures: Pick<Captures['Service'], 'processCapture' | 'failCapture'>
  },
  message: Cloudflare.Queues.Message,
) => {
  const retryOrGiveUp = (giveUp: Effect.Effect<unknown, unknown>) =>
    message.attempts >= processingAttempts
      ? giveUp.pipe(
          Effect.as<Outcome>('ack'),
          Effect.orElseSucceed((): Outcome => 'retry'),
        )
      : Effect.succeed<Outcome>('retry')
  return Schema.decodeUnknownEffect(WorkMessage)(message.body).pipe(
    Effect.flatMap((work) => {
      if ('pieceId' in work)
        return services.wardrobe.processPiece(work.pieceId).pipe(
          Effect.as<Outcome>('ack'),
          Effect.catch(() => retryOrGiveUp(services.wardrobe.failPiece(work.pieceId))),
        )
      if ('captureId' in work)
        return services.captures.processCapture(work.captureId).pipe(
          Effect.as<Outcome>('ack'),
          Effect.catch(() => retryOrGiveUp(services.captures.failCapture(work.captureId))),
        )
      return services.lifecycle.finishDeletion(work.finishDeletionOf).pipe(
        Effect.as<Outcome>('ack'),
        Effect.orElseSucceed((): Outcome => 'retry'),
      )
    }),
    Effect.orElseSucceed((): Outcome => 'ack'),
    Effect.flatMap((outcome) => Effect.sync(() => (outcome === 'ack' ? message.ack() : message.retry()))),
  )
}
