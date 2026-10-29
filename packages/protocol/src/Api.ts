import { SessionHttp } from '@styld/auth/config'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { AccountUnavailable, Me, RequestRefused } from './Account.ts'
import {
  CaptureCreated,
  CaptureId,
  CaptureNotFound,
  CaptureUnavailable,
  CreateCapture,
  CreateVideoCapture,
  DailyLimitReached,
  HeldCheckAnswer,
  HeldCheckRequest,
  Review,
  Reviewed,
  Tray,
} from './Capture.ts'
import { Look, LookId, LookNotFound, Looks } from './Look.ts'
import {
  AddPiece,
  CreateUpload,
  CreateVideoUpload,
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
    HttpApiEndpoint.post('createVideoUpload', '/uploads/video', {
      payload: CreateVideoUpload,
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

/** Photos and videos on their way to pieces. Upload first (`createUpload`/`createVideoUpload`), then
 * create a capture; its pieces wait in the tray until the person reviews them. */
export class CaptureApi extends HttpApiGroup.make('capture')
  .add(
    HttpApiEndpoint.post('createCapture', '/captures', {
      payload: CreateCapture,
      success: CaptureCreated,
      error: [UploadRefused, OperationConflict, DailyLimitReached, CaptureUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('createVideoCapture', '/captures/video', {
      payload: CreateVideoCapture,
      success: CaptureCreated,
      error: [UploadRefused, OperationConflict, DailyLimitReached, CaptureUnavailable, RequestRefused],
    }),
  )
  .add(HttpApiEndpoint.get('tray', '/captures/tray', { success: Tray, error: CaptureUnavailable }))
  .add(
    HttpApiEndpoint.post('review', '/captures/review', {
      payload: Review,
      success: Reviewed,
      error: [CaptureNotFound, OperationConflict, CaptureUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('retry', '/captures/:captureId/retry', {
      params: { captureId: CaptureId },
      success: HttpApiSchema.NoContent,
      error: [CaptureNotFound, DailyLimitReached, CaptureUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.delete('remove', '/captures/:captureId', {
      params: { captureId: CaptureId },
      success: HttpApiSchema.NoContent,
      error: [CaptureNotFound, CaptureUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('check', '/captures/check', {
      payload: HeldCheckRequest,
      success: HeldCheckAnswer,
      error: [CaptureUnavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}

/** Styld's typed HTTP API: declared once, served by the API Worker and called by the website. */
/** The looks assistants made, for the website to show and delete; only assistants make them. */
export class LookApi extends HttpApiGroup.make('look')
  .add(HttpApiEndpoint.get('listLooks', '/looks', { success: Looks, error: WardrobeUnavailable }))
  .add(
    HttpApiEndpoint.get('getLook', '/looks/:lookId', {
      params: { lookId: LookId },
      success: Look,
      error: [LookNotFound, WardrobeUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deleteLook', '/looks/:lookId', {
      params: { lookId: LookId },
      success: HttpApiSchema.NoContent,
      error: [LookNotFound, WardrobeUnavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}

export class StyldApi extends HttpApi.make('styld').add(AccountApi).add(WardrobeApi).add(CaptureApi).add(LookApi) {}
