import { Operation } from './Ids.ts'
import { LimitReached, NotFound, OperationConflict, SlowDown, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
import { SessionAccount } from './Session.ts'
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
      error: [UploadRefused, OperationConflict, LimitReached, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('createVideoCapture', '/captures/video', {
      payload: CreateVideoCapture,
      success: CaptureCreated,
      error: [UploadRefused, OperationConflict, LimitReached, Unavailable],
    }),
  )
  .add(HttpApiEndpoint.get('tray', '/captures/tray', { success: Tray, error: Unavailable }))
  .add(
    HttpApiEndpoint.post('review', '/captures/review', {
      payload: Review,
      success: Reviewed,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('split', '/captures/detections/:detectionId/split', {
      params: { detectionId: DetectionId },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('retry', '/captures/:captureId/retry', {
      params: { captureId: CaptureId },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, LimitReached, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('remove', '/captures/:captureId', {
      params: { captureId: CaptureId },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('check', '/captures/check', {
      payload: HeldCheckRequest,
      success: HeldCheckAnswer,
      error: [SlowDown, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('redrawPicture', '/pieces/:pieceId/picture/redraw', {
      params: { pieceId: PieceId },
      payload: RedrawPicture,
      success: PiecePicture,
      error: [NotFound, PictureRefused, LimitReached, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('makeTurn', '/pieces/:pieceId/turn', {
      params: { pieceId: PieceId },
      payload: Operation,
      success: PieceTurn,
      error: [NotFound, TurnRefused, LimitReached, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('turnSheet', '/pieces/:pieceId/turn/sheet', {
      params: { pieceId: PieceId },
      payload: TurnSheet,
      success: PieceTurn,
      error: [NotFound, SheetRefused, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
