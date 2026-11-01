import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { Effect } from 'effect'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import { OutfitJudge } from './Judge.ts'
import { Thinking } from './Proposer.ts'
import type { ImageBindings } from '../wardrobe/Delivery.ts'
import { makeStore } from '../wardrobe/Store.ts'
import { makeOutfits, type OutfitParts } from './Outfits.ts'
import { makeOutfitStore } from './Store.ts'

/** How many times a day each account may ask Thinking (owner, 2026-10-31); Fast still answers after. */
const thinkingPerDay = 50

/** The outfit engine over the Worker's bindings: Clef ranks, Thinking asks its model. */
export const outfitsLive = (runtime: {
  readonly database: Parameters<typeof makeStore>[0]
  readonly bindings: ImageBindings
  readonly metrics: CaptureMetrics['Service']
  readonly pace: OutfitParts['pace']
}) =>
  Effect.gen(function* () {
    const judge = yield* OutfitJudge
    const proposer = yield* Thinking
    return yield* makeOutfits({
      wardrobe: makeStore(runtime.database),
      days: makeOutfitStore(runtime.database),
      bindings: runtime.bindings,
      judge,
      proposer,
      pace: runtime.pace,
      metrics: runtime.metrics,
      thinkingPerDay,
    }).pipe(Effect.provide(layerCryptoWeb))
  })
