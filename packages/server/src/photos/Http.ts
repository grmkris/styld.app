import { PhotoGarmentId, PhotoId, StyldApi, WardrobeUnavailable } from '@styld/protocol'
import { Effect, Layer, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { makeAuthHttp } from '../AuthHttp.ts'
import { type Admit, asSessionAccount, ownerImage, ShownSize } from '../wardrobe/Http.ts'
import { Photos } from './Photos.ts'

/** My Gallery's endpoints, each the matching `Photos` operation for the session's account; changes are admitted
 * first. */
export const photoHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'photos', (handlers) =>
    Effect.gen(function* () {
      const photos = yield* Photos
      return handlers
        .handle('listPhotos', () =>
          asSessionAccount(photos.listPhotos()).pipe(Effect.map((list) => ({ photos: list }))),
        )
        .handle('addPhoto', ({ payload }) => admit(asSessionAccount(photos.addPhoto(payload))))
        .handle('getPhoto', ({ params }) => asSessionAccount(photos.getPhoto(params.photoId)))
        .handle('updatePhoto', ({ params, payload }) =>
          admit(asSessionAccount(photos.updatePhoto(params.photoId, payload))),
        )
        .handle('deletePhoto', ({ params }) => admit(asSessionAccount(photos.deletePhoto(params.photoId))))
        .handle('matchGarment', ({ params, payload }) =>
          admit(asSessionAccount(photos.matchGarment(params.photoId, params.garmentId, payload))),
        )
        .handle('offerGarment', ({ params }) =>
          admit(asSessionAccount(photos.offerGarment(params.photoId, params.garmentId))),
        )
        .handle('wearAgain', ({ params, payload }) =>
          admit(asSessionAccount(photos.wearAgain(params.photoId, payload))),
        )
        .handle('piecePhotos', ({ params }) =>
          asSessionAccount(photos.piecePhotos(params.pieceId)).pipe(Effect.map((list) => ({ photos: list }))),
        )
    }),
  )

const PhotoTarget = Schema.Struct({ photoId: PhotoId, size: ShownSize })
const GarmentTarget = Schema.Struct({ photoId: PhotoId, garmentId: PhotoGarmentId })

const unavailable = () => WardrobeUnavailable.make({})

/** `GET /cdn/photos/:photoId/:size`: an outfit photo, and `GET /cdn/photos/:photoId/garments/:garmentId`: a garment
 * found in it, for its owner only. A photo never shows to anyone else. */
export const photoRoutes = (auth: ReturnType<typeof makeAuthHttp>) =>
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
