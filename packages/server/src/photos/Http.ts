import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
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
      .handle('addPiece', ({ params, payload }) => photos.addPiece(params.photoId, payload))
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
