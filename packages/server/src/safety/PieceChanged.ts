import { Cause, Context, Effect, Layer } from 'effect'
import type { Checks } from './Checks.ts'

/** A piece's shown picture changed: if others can see the piece, Styld's check of it is pending again and the
 * queue checks it anew. The wardrobe and captures call it; it never fails their work, and a check it could not mark
 * is logged. */
export class PieceChanged extends Context.Service<
  PieceChanged,
  { readonly changed: (pieceId: string) => Effect.Effect<void> }
>()('@styld/server/PieceChanged') {}

/** Piece changes marked through the Worker's checks. */
export const pieceChangedLayer = (checks: Checks['Service']) =>
  Layer.succeed(
    PieceChanged,
    PieceChanged.of({
      changed: (pieceId) =>
        checks.changed({ kind: 'piece', id: pieceId }).pipe(
          Effect.asVoid,
          Effect.catchCause((cause) =>
            Effect.logWarning('Styld.Checks.pieceChanged failed').pipe(
              Effect.annotateLogs({ 'styld.check.cause': Cause.pretty(cause) }),
            ),
          ),
        ),
    }),
  )
