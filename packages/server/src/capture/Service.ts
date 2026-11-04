import { Context, Effect, Layer } from 'effect'
import { creating, reading } from './Captures.ts'
import { retrying } from './Retrying.ts'
import { matching } from './Matching.ts'
import { processing } from './Processing.ts'
import { picturing } from './Pictures.ts'
import { redrawing } from './Redraw.ts'
import { backfilling } from './Backfill.ts'
import { askingTurns, turning } from './Turns.ts'
import { reviewing } from './Review.ts'

/** Every capture operation, each group built over the services it yields (`Shared.ts` `CaptureServices`): the
 * application's database, media and piece queue, the providers, credits, pacing and call counter. Callers provide only
 * `CurrentAccount` (for a person's operations). */
const make = Effect.gen(function* () {
  return {
    ...(yield* creating),
    ...(yield* reading),
    ...(yield* retrying),
    ...(yield* reviewing),
    ...(yield* processing),
    ...(yield* matching),
    ...(yield* picturing),
    ...(yield* redrawing),
    ...(yield* backfilling),
    ...(yield* turning),
    ...(yield* askingTurns),
  }
})

/** Captures: the review tray, clean pictures and turns, for the website, the assistants and the piece queue. */
export class Captures extends Context.Service<Captures, Effect.Success<typeof make>>()(
  '@styld/server/capture/Captures',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Captures.of(service)),
  )
}
