import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { Effect } from 'effect'
import type { RunChat } from '../ai/WorkersAiFetch.ts'
import type { RunClef } from '../capture/Clef.ts'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import type { ImageBindings } from '../wardrobe/Delivery.ts'
import { makeStore } from '../wardrobe/Store.ts'
import { clefJudge, noJudge } from './Judge.ts'
import { makeOutfits, type OutfitParts } from './Outfits.ts'
import { liveProposer, noProposer, standInProposer } from './Proposer.ts'
import { makeOutfitStore } from './Store.ts'

// The outfit engine as the API Worker builds it from its environment: `OUTFITS=live` on the preview (Clef ranks,
// Thinking asks a Workers AI model, `OUTFIT_THINKING_MODEL` or DeepSeek V4.1 Flash), `stand-in` in native acceptance
// (Clef's stand-in ranks, the rules stand in for the model), and otherwise the rules alone with Thinking off.

/** Thinking's model unless the Worker names another: the one Styld answers with, which the owner's probe of 31
 * October found the best at Slovenian and at following instructions. */
const defaultThinkingModel = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'

/** How many times a day each account may ask Thinking (owner, 2026-10-31); Fast still answers after. */
const thinkingPerDay = 50

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.length > 0 ? value : fallback)

export const outfitsLive = (
  env: Readonly<Record<string, unknown>>,
  runtime: {
    readonly database: Parameters<typeof makeStore>[0]
    readonly bindings: ImageBindings
    readonly runClef: RunClef
    readonly runText: RunChat
    readonly metrics: CaptureMetrics['Service']
    readonly pace: OutfitParts['pace']
  },
) => {
  const mode = env['OUTFITS']
  const judge = mode === 'live' || mode === 'stand-in' ? clefJudge(runtime.runClef, runtime.metrics) : noJudge
  const proposer =
    mode === 'live'
      ? liveProposer(runtime.runText, runtime.metrics, text(env['OUTFIT_THINKING_MODEL'], defaultThinkingModel))
      : mode === 'stand-in'
        ? standInProposer
        : noProposer
  return makeOutfits({
    wardrobe: makeStore(runtime.database),
    days: makeOutfitStore(runtime.database),
    bindings: runtime.bindings,
    judge,
    proposer,
    pace: runtime.pace,
    metrics: runtime.metrics,
    thinkingPerDay,
  }).pipe(Effect.provide(layerCryptoWeb))
}
