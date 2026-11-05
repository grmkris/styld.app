import { Effect, Layer } from 'effect'
import { pieceCutout } from '../capture/PieceCutout.ts'
import { moving } from '../jobs/Sweeps.ts'
import { module } from '../kernel/Module.ts'
import { social } from '../social/Module.ts'
import { wardrobeHandlers, wardrobeRoutes } from './Http.ts'
import { WardrobeStore } from './Store.ts'
import { Categories } from './Categories.ts'
import { Wardrobe } from './Wardrobe.ts'

/** The wardrobe: pieces, uploads, backs and pictures. The piece queue they go through is consumed above the modules
 * it serves (`PieceJobs.ts`). */
export const wardrobe = module({
  layer: Layer.mergeAll(
    Wardrobe.layer.pipe(Layer.provide([WardrobeStore.layer, pieceCutout, social.layer])),
    Categories.layer.pipe(Layer.provide(WardrobeStore.layer)),
  ),
  api: wardrobeHandlers,
  routes: wardrobeRoutes,
  sweeps: [
    moving(
      'pieces',
      (stuck, until) => stuck.pieces(until),
      (pieceId) => Effect.flatMap(Wardrobe, (owner) => owner.failPiece(pieceId)),
    ),
    { name: 'uploads', run: Effect.flatMap(Wardrobe, (owner) => owner.sweepUploads()) },
  ],
})
