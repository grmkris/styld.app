import { Effect, Layer } from 'effect'
import { PaidAttempts } from '../../src/usage/Attempts.ts'

// The outfit engine's seams that its service tests do not exercise.

/** One of Ana's ready pieces, with only its photo, added at `addedAt` (ms). */
export const photoPiece = (id: string, type: string, addedAt = 0) =>
  `INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key,
      content_type, created_at, updated_at)
    VALUES ('${id}', 'ac_1', NULL, '${type}', '[]', '[]', 'ready', 'website', 'ac_1/${id}.jpg', NULL, 'image/jpeg',
      ${String(addedAt)}, ${String(addedAt)});`

/** Paid attempts that run their work and are never charged, abandoned or settled: outfit tests about answers, not
 * credit. */
export const freeAttempts = Layer.succeed(
  PaidAttempts,
  PaidAttempts.of({
    run: (_work, effect) => effect,
    charged: () => Effect.die('not used by this test'),
    abandon: () => Effect.die('not used by this test'),
    forget: () => Effect.void,
  }),
)
