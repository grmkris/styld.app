import { Context, Effect, Layer, Schedule } from 'effect'
import { Checks } from './Checks.ts'

/** A piece's shown picture changed: if others can see the piece, Styld's check of it is pending again and the
 * queue checks it anew. The wardrobe and captures call it; it never fails their work. A check it could not mark is
 * tried twice more, then handed to the check queue, which judges the piece as it now shows (a check of other content
 * than the piece shows is checked again) and retries on its own; only when the queue cannot take it either is it
 * logged. Defects and interruptions are not caught. */
export class PieceChanged extends Context.Service<
  PieceChanged,
  { readonly changed: (pieceId: string) => Effect.Effect<void> }
>()('@styld/server/PieceChanged') {
  /** Piece changes marked through the application's checks. */
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const checks = yield* Checks
      return PieceChanged.of({
        changed: (pieceId) => {
          const target = { kind: 'piece', id: pieceId } as const
          return checks.changed(target).pipe(
            Effect.asVoid,
            Effect.retry({ schedule: Schedule.spaced('200 millis'), times: 2 }),
            Effect.catch(() => checks.checkLater([target])),
            Effect.ignore({ log: true, message: 'Styld.Checks.pieceChanged failed' }),
          )
        },
      })
    }),
  )
}
