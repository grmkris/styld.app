import { Effect, Layer } from 'effect'
import { before, moving, type Sweep, unbuiltAfter } from '../jobs/Sweeps.ts'
import type { Database } from '../kernel/Db.ts'
import { module } from '../kernel/Module.ts'
import type { GarmentSegmenter } from './Providers.ts'
import { social } from '../social/Module.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { captureHandlers } from './Http.ts'
import { providerFileSweep } from './ProviderFiles.ts'
import { Captures } from './Service.ts'
import { CaptureStore } from './Store.ts'

/** What captures sweep: their stuck rows, each ended by its owner, and the videos still at Meta. */
const sweeps: ReadonlyArray<Sweep<Captures | Database | GarmentSegmenter>> = [
  providerFileSweep,
  moving(
    'captures',
    (stuck, until) => stuck.captures(until),
    (captureId) => Effect.flatMap(Captures, (owner) => owner.failCapture(captureId)),
  ),
  moving(
    'pictures',
    (stuck, until) => stuck.pictures(until),
    (pieceId) => Effect.flatMap(Captures, (owner) => owner.failPicture(pieceId)),
  ),
  moving(
    'turns',
    (stuck, until) => Effect.flatMap(before(unbuiltAfter), (unbuilt) => stuck.turns(until, unbuilt)),
    (pieceId) => Effect.flatMap(Captures, (owner) => owner.failTurn(pieceId)),
  ),
]

/** Captures: the review tray, clean pictures and turns. Their queue work runs on the piece queue (`wardrobe`). */
export const capture = module({
  layer: Captures.layer.pipe(Layer.provide([CaptureStore.layer, WardrobeStore.layer, social.layer])),
  api: captureHandlers,
  sweeps,
})
