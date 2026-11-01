import { entityId, Operation, OperationId } from './Ids.ts'
import { LimitReached, NotFound, OperationConflict, refusal, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
import { SessionAccount } from './Session.ts'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { BoardId } from './Board.ts'
import { PieceType } from './Garment.ts'
import { CreateLook, Look, LookId } from './Look.ts'
import { Colour, PieceId, UploadId, UploadRefused } from './Wardrobe.ts'

// My Gallery (owner, 2026-10-31): the person's own outfit photos, optional and private. Styld finds the garments in a
// photo for a credit and matches each to a piece; the person confirms or corrects it. Never public, never a capture.

export const PhotoId = entityId('ph').pipe(Schema.brand('PhotoId'))
export type PhotoId = typeof PhotoId.Type
export const PhotoGarmentId = entityId('pg').pipe(Schema.brand('PhotoGarmentId'))
export type PhotoGarmentId = typeof PhotoGarmentId.Type

/** Where finding a photo's garments stands: under way, done, or given up (its credit came back). */
export const PhotoStatus = Schema.Literals(['finding', 'ready', 'failed'])
export type PhotoStatus = typeof PhotoStatus.Type

/** Where a garment's match stands: Styld's guess, the person's confirmed piece, nothing in the wardrobe, or sent to
 * the review tray to be added. */
export const GarmentMatch = Schema.Literals(['suggested', 'confirmed', 'unmatched', 'offered'])
export type GarmentMatch = typeof GarmentMatch.Type

/** A garment found in a photo: what Styld took it for, and the piece it is when there is one. */
export const PhotoGarment = Schema.Struct({
  id: PhotoGarmentId,
  type: Schema.NullOr(PieceType),
  colours: Schema.Array(Colour),
  match: GarmentMatch,
  pieceId: Schema.NullOr(PieceId),
})
export type PhotoGarment = typeof PhotoGarment.Type

/** An outfit photo, its garments in the order found, and what was made of it. */
export const Photo = Schema.Struct({
  id: PhotoId,
  status: PhotoStatus,
  favourite: Schema.Boolean,
  garments: Schema.Array(PhotoGarment),
  lookId: Schema.NullOr(LookId),
  hasCutout: Schema.Boolean,
  createdAt: Schema.String,
})
export type Photo = typeof Photo.Type

export const Photos = Schema.Struct({ photos: Schema.Array(Photo) })

/** Add an outfit photo from a received upload: `POST /api/photos`, a credit for finding its garments. */
export const AddPhoto = Schema.Struct({ operationId: OperationId, uploadId: UploadId })
export type AddPhoto = typeof AddPhoto.Type

/** Mark a photo a favourite or not: `PATCH /api/photos/:photoId`. */
export const UpdatePhoto = Schema.Struct({ operationId: OperationId, favourite: Schema.Boolean })

/** Confirm a garment as one of the person's pieces, correct it to another, or say none of them is it:
 * `PUT /api/photos/:photoId/garments/:garmentId`. */
export const MatchGarment = Schema.Struct({ operationId: OperationId, pieceId: Schema.NullOr(PieceId) })
export type MatchGarment = typeof MatchGarment.Type

/** "Wear it again": the photo's confirmed pieces saved as a look, under the name the person's language gives it:
 * `POST /api/photos/:photoId/look`. */
export const WearAgain = Schema.Struct({ operationId: OperationId, name: CreateLook.fields.name })
export type WearAgain = typeof WearAgain.Type

/** Put an outfit photo (its cut-out once it has one) on one of the person's boards, with the look worn from it:
 * `POST /api/photos/:photoId/board`. The board shows the photo to its owner only. */
export const AddPhotoToBoard = Schema.Struct({ operationId: OperationId, boardId: BoardId })
export type AddPhotoToBoard = typeof AddPhotoToBoard.Type

/** Styld found no person to cut out of the photo. */
export class NoPersonFound extends Schema.TaggedError<NoPersonFound>()(
  'NoPersonFound',
  {},
  {
    httpApiStatus: 422,
    guide: refusal('no_person', 'Styld found no person in that photo.', 'Use a photo of someone wearing the outfit.'),
  },
) {}

/** A photo with no piece confirmed in it yet has nothing to wear again. */
export class NothingConfirmed extends Schema.TaggedError<NothingConfirmed>()(
  'NothingConfirmed',
  {},
  {
    httpApiStatus: 409,
    guide: refusal('nothing_confirmed', 'No piece is confirmed in that photo yet.', 'Confirm its pieces first.'),
  },
) {}

const photoPath = { photoId: PhotoId }

export class PhotoApi extends HttpApiGroup.make('photo')
  .add(HttpApiEndpoint.get('listPhotos', '/photos', { success: Photos, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('addPhoto', '/photos', {
      payload: AddPhoto,
      success: Photo,
      error: [UploadRefused, OperationConflict, LimitReached, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('getPhoto', '/photos/:photoId', {
      params: photoPath,
      success: Photo,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.patch('updatePhoto', '/photos/:photoId', {
      params: photoPath,
      payload: UpdatePhoto,
      success: Photo,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deletePhoto', '/photos/:photoId', {
      params: photoPath,
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.put('matchGarment', '/photos/:photoId/garments/:garmentId', {
      params: { ...photoPath, garmentId: PhotoGarmentId },
      payload: MatchGarment,
      success: Photo,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('offerGarment', '/photos/:photoId/garments/:garmentId/offer', {
      params: { ...photoPath, garmentId: PhotoGarmentId },
      payload: Operation,
      success: Photo,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('wearAgain', '/photos/:photoId/look', {
      params: photoPath,
      payload: WearAgain,
      success: Look,
      error: [NotFound, NothingConfirmed, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('cutOut', '/photos/:photoId/cutout', {
      params: photoPath,
      payload: Operation,
      success: Photo,
      error: [NotFound, NoPersonFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('addToBoard', '/photos/:photoId/board', {
      params: photoPath,
      payload: AddPhotoToBoard,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('piecePhotos', '/pieces/:pieceId/photos', {
      params: { pieceId: PieceId },
      success: Photos,
      error: [NotFound, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
