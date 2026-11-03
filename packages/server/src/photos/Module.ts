import { Effect, Layer } from 'effect'
import { CaptureStore } from '../capture/Store.ts'
import { moving } from '../jobs/Sweeps.ts'
import { module } from '../kernel/Module.ts'
import { social } from '../social/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { photoHandlers } from './Http.ts'
import { Photos } from './Photos.ts'
import { PhotoStore } from './Store.ts'

/** My Gallery: outfit photos, the garments found in them, and what they give the wardrobe and the boards. Finding
 * runs on the piece queue (`wardrobe`). */
export const photos = module({
  layer: Photos.layer.pipe(
    Layer.provide([PhotoStore.layer, CaptureStore.layer, WardrobeStore.layer, social.layer, wardrobe.layer]),
  ),
  api: photoHandlers,
  sweeps: [
    moving(
      'photos',
      (stuck, until) => stuck.photos(until),
      (photoId) => Effect.flatMap(Photos, (owner) => owner.failFinding(photoId)),
    ),
  ],
})
