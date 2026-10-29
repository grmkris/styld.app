import { SessionHttp } from '@styld/auth/config'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { AccountUnavailable, Me, RequestRefused } from './Account.ts'
import {
  AddPiece,
  CreateUpload,
  OperationConflict,
  Piece,
  PieceId,
  PieceNotFound,
  Pieces,
  SubcategoryMismatch,
  UpdatePiece,
  Upload,
  UploadRefused,
  WardrobeUnavailable,
} from './Wardrobe.ts'

/** The signed-in person's account. */
export class AccountApi extends HttpApiGroup.make('account')
  .add(HttpApiEndpoint.get('me', '/me', { success: Me }))
  /** Delete the account, its wardrobe and photos, its sessions and assistants' access, for good. */
  .add(
    HttpApiEndpoint.delete('deleteMe', '/me', {
      success: HttpApiSchema.NoContent,
      error: [AccountUnavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}

/** The signed-in person's pieces. A photo goes up first (`createUpload`, then a `PUT` of its bytes
 * to the returned path) and becomes a piece with `addPiece`. */
export class WardrobeApi extends HttpApiGroup.make('wardrobe')
  .add(HttpApiEndpoint.get('listPieces', '/pieces', { success: Pieces, error: WardrobeUnavailable }))
  .add(
    HttpApiEndpoint.get('getPiece', '/pieces/:pieceId', {
      params: { pieceId: PieceId },
      success: Piece,
      error: [PieceNotFound, WardrobeUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('createUpload', '/uploads', {
      payload: CreateUpload,
      success: Upload,
      error: [WardrobeUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('addPiece', '/pieces', {
      payload: AddPiece,
      success: Piece,
      error: [UploadRefused, SubcategoryMismatch, OperationConflict, WardrobeUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.patch('updatePiece', '/pieces/:pieceId', {
      params: { pieceId: PieceId },
      payload: UpdatePiece,
      success: Piece,
      error: [PieceNotFound, SubcategoryMismatch, WardrobeUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deletePiece', '/pieces/:pieceId', {
      params: { pieceId: PieceId },
      success: HttpApiSchema.NoContent,
      error: [PieceNotFound, WardrobeUnavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}

/** Styld's typed HTTP API: declared once, served by the API Worker and called by the website. */
export class StyldApi extends HttpApi.make('styld').add(AccountApi).add(WardrobeApi) {}
