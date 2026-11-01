import { LimitReached, NotFound, OperationConflict, RequestRefused, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  CaptureCreated,
  CaptureId,
  CreateCapture,
  CreateVideoCapture,
  DetectionId,
  HeldCheckAnswer,
  HeldCheckRequest,
  Review,
  Reviewed,
  Tray,
} from './Capture.ts'
import {
  MakeTurn,
  PictureBackfill,
  PictureRefused,
  PieceId,
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
      error: [UploadRefused, OperationConflict, LimitReached, Unavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('createVideoCapture', '/captures/video', {
      payload: CreateVideoCapture,
      success: CaptureCreated,
      error: [UploadRefused, OperationConflict, LimitReached, Unavailable, RequestRefused],
    }),
  )
  .add(HttpApiEndpoint.get('tray', '/captures/tray', { success: Tray, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('review', '/captures/review', {
      payload: Review,
      success: Reviewed,
      error: [NotFound, OperationConflict, Unavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('split', '/captures/detections/:detectionId/split', {
      params: { detectionId: DetectionId },
      success: HttpApiSchema.NoContent,
      error: [NotFound, Unavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('retry', '/captures/:captureId/retry', {
      params: { captureId: CaptureId },
      success: HttpApiSchema.NoContent,
      error: [NotFound, LimitReached, Unavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.delete('remove', '/captures/:captureId', {
      params: { captureId: CaptureId },
      success: HttpApiSchema.NoContent,
      error: [NotFound, Unavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('check', '/captures/check', {
      payload: HeldCheckRequest,
      success: HeldCheckAnswer,
      error: [Unavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('redrawPicture', '/pieces/:pieceId/picture/redraw', {
      params: { pieceId: PieceId },
      payload: RedrawPicture,
      success: PiecePicture,
      error: [NotFound, PictureRefused, LimitReached, Unavailable, RequestRefused],
    }),
  )
  .add(HttpApiEndpoint.get('undrawnPictures', '/pictures', { success: PictureBackfill, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('drawPictures', '/pictures', {
      success: PictureBackfill,
      error: [Unavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('makeTurn', '/pieces/:pieceId/turn', {
      params: { pieceId: PieceId },
      payload: MakeTurn,
      success: PieceTurn,
      error: [NotFound, TurnRefused, LimitReached, Unavailable, RequestRefused],
    }),
  )
  .add(
    HttpApiEndpoint.post('turnSheet', '/pieces/:pieceId/turn/sheet', {
      params: { pieceId: PieceId },
      payload: TurnSheet,
      success: PieceTurn,
      error: [NotFound, SheetRefused, Unavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession) {}
