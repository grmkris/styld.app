import type * as Cloudflare from '@alchemy.run/cloudflare'
import { Cause, Effect, Schema } from 'effect'
import type { StylistService } from './Service.ts'

/** Queue message: write Styld's reply to a message. */
export const StylistTurn = Schema.Struct({ stylistTurnOf: Schema.String, accountId: Schema.String })

/** Delivery attempts before a reply shows as failed and its credit comes back. */
export const stylistAttempts = 3

/** Settle one reply message exactly once: written, retried later, or given up on after the last attempt. A body that
 * is no reply can never succeed, so it is dropped. */
export const settleStylistTurn = (
  stylist: Pick<StylistService, 'processTurn' | 'failTurn'>,
  message: Cloudflare.Queues.Message,
) =>
  Schema.decodeUnknownEffect(StylistTurn)(message.body).pipe(
    Effect.flatMap(({ stylistTurnOf, accountId }) =>
      stylist.processTurn(accountId, stylistTurnOf).pipe(
        Effect.as<'ack' | 'retry'>('ack'),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning('Styld.Stylist reply failed').pipe(
              Effect.annotateLogs({
                'styld.queue.attempt': message.attempts,
                'styld.queue.cause': Cause.pretty(cause),
              }),
            )
            if (message.attempts < stylistAttempts) return 'retry' as const
            yield* stylist.failTurn(accountId, stylistTurnOf).pipe(Effect.ignore)
            return 'ack' as const
          }),
        ),
      ),
    ),
    Effect.orElseSucceed(() => 'ack' as const),
    Effect.flatMap((outcome) => Effect.sync(() => (outcome === 'ack' ? message.ack() : message.retry()))),
  )
