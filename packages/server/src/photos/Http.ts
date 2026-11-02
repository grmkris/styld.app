import { PhotoGarmentId, PhotoId, StyldApi, Unavailable } from '@styld/protocol'
import { Effect, Layer, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { AuthHttp } from '../AuthHttp.ts'
import { ownerImage, ShownSize } from '../wardrobe/Http.ts'
import { Photos } from './Photos.ts'

/** My Gallery's endpoints, each the matching `Photos` operation for the session's account; changes are admitted
 * first. */
export const photoHandlers = HttpApiBuilder.group(StyldApi, 'photo', (handlers) =>
  Effect.gen(function* () {
    const photos = yield* Photos
    return handlers
      .handle('listPhotos', () => photos.listPhotos().pipe(Effect.map((list) => ({ photos: list }))))
      .handle('addPhoto', ({ payload }) => photos.addPhoto(payload))
      .handle('getPhoto', ({ params }) => photos.getPhoto(params.photoId))
      .handle('updatePhoto', ({ params, payload }) => photos.updatePhoto(params.photoId, payload))
      .handle('deletePhoto', ({ params, payload }) => photos.deletePhoto(params.photoId, payload.operationId))
      .handle('matchGarment', ({ params, payload }) => photos.matchGarment(params.photoId, params.garmentId, payload))
      .handle('offerGarment', ({ params, payload }) =>
        photos.offerGarment(params.photoId, params.garmentId, payload.operationId),
      )
      .handle('wearAgain', ({ params, payload }) => photos.wearAgain(params.photoId, payload))
      .handle('cutOut', ({ params, payload }) => photos.cutOut(params.photoId, payload.operationId))
      .handle('addToBoard', ({ params, payload }) => photos.addToBoard(params.photoId, payload))
      .handle('piecePhotos', ({ params }) =>
        photos.piecePhotos(params.pieceId).pipe(Effect.map((list) => ({ photos: list }))),
      )
  }),
)

const PhotoTarget = Schema.Struct({ photoId: PhotoId, size: ShownSize })
const GarmentTarget = Schema.Struct({ photoId: PhotoId, garmentId: PhotoGarmentId })

const unavailable = () => Unavailable.make({})

/** `GET /cdn/photos/:photoId/:size`: an outfit photo, and `GET /cdn/photos/:photoId/garments/:garmentId`: a garment
 * found in it, for its owner only. A photo never shows to anyone else. */
export const photoRoutes = (auth: AuthHttp) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const photos = yield* Photos
      const photo = yield* ownerImage(auth, PhotoTarget, ({ photoId, size }) =>
        photos.photoImage(photoId, size).pipe(Effect.mapError(unavailable)),
      )
      const garment = yield* ownerImage(auth, GarmentTarget, ({ photoId, garmentId }) =>
        photos.garmentImage(photoId, garmentId).pipe(Effect.mapError(unavailable)),
      )
      return Layer.mergeAll(
        HttpRouter.add('GET', '/cdn/photos/:photoId/garments/:garmentId', garment),
        HttpRouter.add('GET', '/cdn/photos/:photoId/:size', photo),
      )
    }),
  )
