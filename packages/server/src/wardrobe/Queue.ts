import type * as Cloudflare from '@alchemy.run/cloudflare'
import { Cause, Effect, Schema } from 'effect'
import type { AccountLifecycle } from '../AccountLifecycle.ts'
import type { Captures } from '../capture/Service.ts'
import { WorkMessage } from './Processing.ts'
import type { Wardrobe } from './Wardrobe.ts'

/** Delivery attempts before a piece shows as failed; a deletion is retried as many times. */
export const processingAttempts = 3

type Outcome = 'ack' | 'retry'

/** Settle one queue message exactly once: done, retried later, or after the last attempt marked
 * failed. Any failure counts, defects too, so a capture never stays processing because its pipeline
 * threw; each is logged with its cause. A body that is no known message can never succeed, so it is
 * dropped. */
export const settleMessage = (
  services: {
    readonly wardrobe: Wardrobe['Service']
    readonly lifecycle: AccountLifecycle['Service']
    readonly captures: Pick<
      Captures['Service'],
      | 'processCapture'
      | 'failCapture'
      | 'processPicture'
      | 'failPicture'
      | 'processTurn'
      | 'failTurn'
      | 'processMatch'
      | 'failMatch'
    >
  },
  message: Cloudflare.Queues.Message,
) => {
  const logged = (cause: Cause.Cause<unknown>) =>
    Effect.logWarning('Styld.Queue work failed').pipe(
      Effect.annotateLogs({ 'styld.queue.attempt': message.attempts, 'styld.queue.cause': Cause.pretty(cause) }),
    )
  const retryOrGiveUp = (giveUp: Effect.Effect<unknown, unknown>) =>
    message.attempts >= processingAttempts
      ? giveUp.pipe(
          Effect.as<Outcome>('ack'),
          Effect.catchCause((cause) => Effect.as(logged(cause), 'retry' as const)),
        )
      : Effect.succeed<Outcome>('retry')
  const work = (run: Effect.Effect<unknown, unknown>, giveUp: Effect.Effect<unknown, unknown>) =>
    run.pipe(
      Effect.as<Outcome>('ack'),
      Effect.catchCause((cause) => Effect.andThen(logged(cause), retryOrGiveUp(giveUp))),
    )
  return Schema.decodeUnknownEffect(WorkMessage)(message.body).pipe(
    Effect.flatMap((body) => {
      if ('pieceId' in body)
        return work(services.wardrobe.processPiece(body.pieceId), services.wardrobe.failPiece(body.pieceId))
      if ('captureId' in body)
        return work(services.captures.processCapture(body.captureId), services.captures.failCapture(body.captureId))
      if ('matchOf' in body)
        return work(services.captures.processMatch(body.matchOf), services.captures.failMatch(body.matchOf))
      if ('turnOf' in body)
        return work(services.captures.processTurn(body.turnOf), services.captures.failTurn(body.turnOf))
      if ('cleanPictureOf' in body)
        return work(
          services.captures.processPicture(body.cleanPictureOf),
          services.captures.failPicture(body.cleanPictureOf),
        )
      return services.lifecycle.finishDeletion(body.finishDeletionOf).pipe(
        Effect.as<Outcome>('ack'),
        Effect.catchCause((cause) => Effect.as(logged(cause), 'retry' as const)),
      )
    }),
    Effect.orElseSucceed((): Outcome => 'ack'),
    Effect.flatMap((outcome) => Effect.sync(() => (outcome === 'ack' ? message.ack() : message.retry()))),
  )
}
