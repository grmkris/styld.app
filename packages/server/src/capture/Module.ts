import { Effect, Layer } from 'effect'
import { withAuth } from '../AuthHttp.ts'
import { before, moving, unbuiltAfter } from '../jobs/Sweeps.ts'
import { module } from '../kernel/Module.ts'
import { social } from '../social/Module.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { captureHandlers, captureRoutes } from './Http.ts'
import { Captures } from './Service.ts'
import { CaptureStore } from './Store.ts'

/** Captures: the review tray, clean pictures and turns. Their queue work runs on the piece queue (`wardrobe`). */
export const capture = module({
  layer: Captures.layer.pipe(Layer.provide([CaptureStore.layer, WardrobeStore.layer, social.layer])),
  api: captureHandlers,
  routes: withAuth(captureRoutes),
  sweeps: [
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
  ],
})
