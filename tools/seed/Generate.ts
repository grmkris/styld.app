import { Effect, Exit, Match, Option, Redacted, Schema } from 'effect'
import { metaBase } from '../../packages/server/src/providers/Meta.ts'
import { makeMusePainter } from '../../packages/server/src/providers/Muse.ts'
import type { ProviderError } from '../../packages/server/src/providers/Errors.ts'
import type { Fetch } from '../../packages/server/src/providers/Http.ts'
import { CaptureMetrics } from '../../packages/server/src/kernel/Metrics.ts'
import { prices } from './Ledger.ts'
import type { MuseSize } from './Prompt.ts'

// One house garment drawn from words by Meta Muse Image, through the Worker's own adapter (`providers/Muse.ts`: the
// Standard model, the same request body, retried only while Meta is busy, never sent again once it may have been
// taken). The seed's ledger charges what each outcome cost.

/** A picture Muse drew: PNG bytes. */
interface Drawn {
  readonly bytes: Uint8Array
}

/** Something that draws one garment from words; tests use their own. */
export interface Painter {
  readonly paint: (prompt: string, size: MuseSize) => Promise<Drawn>
}

/** Muse did not draw the garment; `billed` says whether Meta may have charged for it. */
export class NotDrawn extends Schema.TaggedError<NotDrawn>()('NotDrawn', {
  reason: Schema.Literals(['refused', 'busy', 'unknown', 'broken']),
  billed: Schema.Boolean,
  message: Schema.String,
}) {}

export const notDrawnFor = (reason: NotDrawn['reason'], billed: boolean) =>
  NotDrawn.make({ reason, billed, message: `Muse did not draw it (${reason})` })

const notDrawn = (error: ProviderError) =>
  Match.value(error.reason).pipe(
    Match.tagsExhaustive({
      Refused: () => notDrawnFor('refused', false),
      Busy: () => notDrawnFor('busy', false),
      OutcomeUnknown: () => notDrawnFor('unknown', true),
      Broken: () => notDrawnFor('broken', true),
    }),
  )

/** Muse over `fetch` (IPv6 from this machine, `MetaFetch.ts`) with the operator's `META_MUSE_API_KEY`. */
export const musePainter = (key: string, fetch: Fetch): Painter => {
  const painter = makeMusePainter({
    base: metaBase,
    key: Redacted.make(key),
    fetch,
    metrics: CaptureMetrics.discarding,
  })
  return {
    paint: async (prompt, size) => {
      const exit = await Effect.runPromiseExit(painter.paint({ prompt, key: 'green' }, size))
      if (Exit.isSuccess(exit)) return { bytes: exit.value.bytes }
      const failure = Exit.findErrorOption(exit)
      throw Option.isSome(failure) ? notDrawn(failure.value) : notDrawnFor('unknown', true)
    },
  }
}

/** What a Muse call is charged: a picture, or a failure Meta may have billed, costs one picture. */
export const museCharge = {
  worst: prices.musePerImage,
  cost: () => prices.musePerImage,
  failed: (error: unknown) => (error instanceof NotDrawn && !error.billed ? 0 : prices.musePerImage),
}
