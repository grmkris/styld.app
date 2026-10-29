import type * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect, Schema } from 'effect'
import { ProcessPiece } from './Processing.ts'
import type { Wardrobe } from './Wardrobe.ts'

/** Delivery attempts for a piece's processing before it is shown as failed. */
export const processingAttempts = 3

/** Settle one queue message exactly once: done, retried later, or after the last attempt marked
 * failed. A body that is not a piece message can never succeed, so it is dropped. */
export const settlePieceMessage = (wardrobe: Wardrobe['Service'], message: Cloudflare.Queues.Message) =>
  Schema.decodeUnknownEffect(ProcessPiece)(message.body).pipe(
    Effect.flatMap(({ pieceId }) =>
      wardrobe.processPiece(pieceId).pipe(
        Effect.as<'ack' | 'retry'>('ack'),
        Effect.catch(() =>
          message.attempts >= processingAttempts
            ? wardrobe.failPiece(pieceId).pipe(Effect.ignore, Effect.as<'ack' | 'retry'>('ack'))
            : Effect.succeed<'ack' | 'retry'>('retry'),
        ),
      ),
    ),
    Effect.orElseSucceed((): 'ack' | 'retry' => 'ack'),
    Effect.flatMap((outcome) => Effect.sync(() => (outcome === 'ack' ? message.ack() : message.retry()))),
  )
