import { Context, Effect, Layer } from 'effect'
import { Media } from '../kernel/Media.ts'
import { PieceQueue } from '../wardrobe/Processing.ts'
import { creating, reading } from './Captures.ts'
import { retrying } from './Retrying.ts'
import { matching } from './Matching.ts'
import { makeParts } from './Parts.ts'
import { processing } from './Processing.ts'
import { picturing } from './Pictures.ts'
import { redrawing } from './Redraw.ts'
import { askingTurns, turning } from './Turns.ts'
import { detectionPictures, reviewing } from './Review.ts'

/** Every capture operation over the application's database, media and piece queue, with the providers, credits and
 * call counter it was built with (`Parts.ts`). Callers provide only `CurrentAccount` (for a person's operations). */
const make = Effect.gen(function* () {
  const media = yield* Media
  const parts = yield* makeParts({ bucket: media.bucket, queue: yield* PieceQueue })
  return {
    ...creating(parts),
    ...reading(parts),
    ...retrying(parts),
    ...reviewing(parts),
    ...detectionPictures(parts),
    ...processing(parts),
    ...matching(parts),
    ...picturing(parts),
    ...redrawing(parts),
    ...turning(parts),
    ...askingTurns(parts),
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
