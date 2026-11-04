import { entityId, Operation, OperationId } from './Ids.ts'
import { LimitReached, NotFound, OperationConflict, SlowDown, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
import { SessionAccount } from './Session.ts'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { BoardId } from './Board.ts'
import { PhotoId } from './Photo.ts'
import { PieceId } from './Wardrobe.ts'

// Try on (owner, 4 November 2026): one of the person's own My Gallery photos, redrawn by Meta Muse Image with them
// wearing pieces of their own wardrobe. The only original photo Styld ever sends to a provider, and only once the
// person has said the photo is of them (ROADMAP › Privacy exception). The result is theirs: private until they put it
// on a board.

export const TryOnId = entityId('to').pipe(Schema.brand('TryOnId'))
export type TryOnId = typeof TryOnId.Type

/** The most pieces one try-on wears: Muse takes ten pictures, and the photo is the first. */
export const maximumTryOnPieces = 9

/** Try a photo on with pieces: `POST /api/try-ons`. `thisIsMe` is the person's word that the photo shows them, the
 * one condition under which Styld sends an original photo out. */
export const StartTryOn = Schema.Struct({
  operationId: OperationId,
  photoId: PhotoId,
  pieceIds: Schema.Array(PieceId).check(Schema.isMinLength(1), Schema.isMaxLength(maximumTryOnPieces)),
  thisIsMe: Schema.Literal(true),
})
export type StartTryOn = typeof StartTryOn.Type

/** How far a try-on got: its credits held, being drawn, done; or refused by the image model, or lost on the way (its
 * credits given back either way). */
export const TryOnStatus = Schema.Literals(['admitting', 'drawing', 'done', 'refused', 'failed'])
export type TryOnStatus = typeof TryOnStatus.Type

/** A try-on as its owner reads it: the photo it started from, the pieces it wears, and the result once drawn, at its
 * owner's signed addresses. */
export const TryOn = Schema.Struct({
  id: TryOnId,
  photoId: PhotoId,
  pieceIds: Schema.Array(PieceId),
  status: TryOnStatus,
  images: Schema.optionalKey(Schema.Struct({ thumb: Schema.String, full: Schema.String })),
  createdAt: Schema.String,
})
export type TryOn = typeof TryOn.Type

export const TryOns = Schema.Struct({ tryOns: Schema.Array(TryOn) })
export type TryOns = typeof TryOns.Type

/** Put a try-on's result on one of the person's boards: `POST /api/try-ons/:tryOnId/board`. */
export const AddTryOnToBoard = Schema.Struct({ operationId: OperationId, boardId: BoardId })
export type AddTryOnToBoard = typeof AddTryOnToBoard.Type

const tryOnPath = { tryOnId: TryOnId }

export class TryOnApi extends HttpApiGroup.make('tryOn')
  .add(HttpApiEndpoint.get('listTryOns', '/try-ons', { success: TryOns, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('startTryOn', '/try-ons', {
      payload: StartTryOn,
      success: TryOn,
      error: [NotFound, LimitReached, SlowDown, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('getTryOn', '/try-ons/:tryOnId', {
      params: tryOnPath,
      success: TryOn,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deleteTryOn', '/try-ons/:tryOnId', {
      params: tryOnPath,
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('addTryOnToBoard', '/try-ons/:tryOnId/board', {
      params: tryOnPath,
      payload: AddTryOnToBoard,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
