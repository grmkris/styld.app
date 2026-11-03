import { Effect, Layer } from 'effect'
import { AccountLifecycle } from '../AccountLifecycle.ts'
import { pieceCutout } from '../capture/PieceCutout.ts'
import { Captures } from '../capture/Service.ts'
import { consumer } from '../jobs/Jobs.ts'
import { moving } from '../jobs/Sweeps.ts'
import { module } from '../kernel/Module.ts'
import { Photos } from '../photos/Photos.ts'
import { social } from '../social/Module.ts'
import { wardrobeHandlers, wardrobeRoutes } from './Http.ts'
import { pieceJobQueue, pieceJobs } from './Queue.ts'
import { WardrobeStore } from './Store.ts'
import { Categories } from './Categories.ts'
import { Wardrobe } from './Wardrobe.ts'

/** The wardrobe: pieces, uploads, backs and pictures, and the piece queue every piece, capture and photo job goes
 * through. */
export const wardrobe = module({
  layer: Layer.mergeAll(
    Wardrobe.layer.pipe(Layer.provide([WardrobeStore.layer, pieceCutout, social.layer])),
    Categories.layer.pipe(Layer.provide(WardrobeStore.layer)),
  ),
  api: wardrobeHandlers,
  routes: wardrobeRoutes,
  consumers: [
    consumer(
      pieceJobQueue,
      Effect.map(
        Effect.all({ wardrobe: Wardrobe, lifecycle: AccountLifecycle, captures: Captures, photos: Photos }),
        pieceJobs,
      ),
    ),
  ],
  sweeps: [
    moving(
      'pieces',
      (stuck, until) => stuck.pieces(until),
      (pieceId) => Effect.flatMap(Wardrobe, (owner) => owner.failPiece(pieceId)),
    ),
    { name: 'uploads', run: Effect.flatMap(Wardrobe, (owner) => owner.sweepUploads()) },
  ],
})
