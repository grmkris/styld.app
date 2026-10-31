import { SessionHttp } from '@styld/auth/config'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { RequestRefused } from './Account.ts'
import {
  CaptureCreated,
  CaptureId,
  CaptureNotFound,
  CaptureUnavailable,
  CreateCapture,
  CreateVideoCapture,
  DailyLimitReached,
  DetectionId,
  HeldCheckAnswer,
  HeldCheckRequest,
  Review,
  Reviewed,
  Tray,
} from './Capture.ts'
import {
  MakeTurn,
  OperationConflict,
  PictureBackfill,
  PictureRefused,
  PieceId,
  PieceNotFound,
  PiecePicture,
  PieceTurn,
  RedrawPicture,
  SheetRefused,
  TurnRefused,
  TurnSheet,
  UploadRefused,
} from './Wardrobe.ts'

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
    HttpApiEndpoint.post('split', '/captures/detections/:detectionId/split', {
      params: { detectionId: DetectionId },
      success: HttpApiSchema.NoContent,
      error: [CaptureNotFound, CaptureUnavailable, RequestRefused],
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
  .add(
    HttpApiEndpoint.post('redrawPicture', '/pieces/:pieceId/picture/redraw', {
      params: { pieceId: PieceId },
      payload: RedrawPicture,
      success: PiecePicture,
      error: [PieceNotFound, PictureRefused, DailyLimitReached, CaptureUnavailable, RequestRefused],
    }),
  )
  .add(HttpApiEndpoint.get('undrawnPictures', '/pictures', { success: PictureBackfill, error: CaptureUnavailable }))
  .add(
    HttpApiEndpoint.post('drawPictures', '/pictures', {
      success: PictureBackfill,
      error: [CaptureUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('makeTurn', '/pieces/:pieceId/turn', {
      params: { pieceId: PieceId },
      payload: MakeTurn,
      success: PieceTurn,
      error: [PieceNotFound, TurnRefused, DailyLimitReached, CaptureUnavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('turnSheet', '/pieces/:pieceId/turn/sheet', {
      params: { pieceId: PieceId },
      payload: TurnSheet,
      success: PieceTurn,
      error: [PieceNotFound, SheetRefused, CaptureUnavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}
