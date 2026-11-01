import { maximumColours, maximumImageBytes, maximumVideoBytes } from './Limits.ts'
import { Hint, Name, Notes } from './Text.ts'
import { entityId, OperationId } from './Ids.ts'
import { Schema } from 'effect'
import { byCase, passing, refusal } from './Errors.ts'
import { Brand, Occasions, Pattern, PieceType, Season, ShopUrl } from './Garment.ts'

/** The thirteen plain colours a person can pick (v1's `CATALOG_COLORS`). */
export const Colour = Schema.Literals([
  'black',
  'white',
  'grey',
  'beige',
  'brown',
  'navy',
  'blue',
  'green',
  'red',
  'pink',
  'yellow',
  'orange',
  'purple',
])
export type Colour = typeof Colour.Type

/** A piece's colours: distinct, at most six. */
export const Colours = Schema.Array(Colour).check(Schema.isUnique(), Schema.isMaxLength(maximumColours))

export const PieceId = entityId('pc').pipe(Schema.brand('PieceId'))
export type PieceId = typeof PieceId.Type
export const UploadId = entityId('up').pipe(Schema.brand('UploadId'))
export type UploadId = typeof UploadId.Type

/** Photos Styld accepts. HEIC is not among them yet: browsers convert it to JPEG on upload. */
export const ImageType = Schema.Literals(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
export type ImageType = typeof ImageType.Type

/** A wardrobe video: the containers phones record and Meta SAM reads. */
export const VideoType = Schema.Literals(['video/mp4', 'video/quicktime'])
export type VideoType = typeof VideoType.Type

/** A piece waits in `processing` while its photo is prepared, then shows as `ready`. */
export const PieceStatus = Schema.Literals(['processing', 'ready', 'failed'])
export type PieceStatus = typeof PieceStatus.Type

/** Who added the piece: the person on the website, or an assistant on their behalf. */
export const PieceSource = Schema.Literals(['website', 'assistant'])

/** A piece's clean picture (owner, 2026-10-30): an image model's drawing of the garment from its kept cut-out, shown
 * beside the real photo and marked as AI-cleaned. `drawing` while it is made; `ready` when shown on its own; `proposed`
 * when the person chooses; `retake` when the cut-out shows too little of the garment; `kept` when the photo was
 * already clean or showed a face; `failed` when no drawing came of it. */
export const PictureState = Schema.Literals(['drawing', 'ready', 'proposed', 'retake', 'kept', 'failed'])
export type PictureState = typeof PictureState.Type

/** Which picture a piece shows: the clean drawing or the person's own photo. */
export const PictureChoice = Schema.Literals(['clean', 'photo'])
export type PictureChoice = typeof PictureChoice.Type

export const PiecePicture = Schema.Struct({
  state: PictureState,
  shows: PictureChoice,
  /** Counts drawings; image addresses carry it, so a new drawing is never served from a cache. */
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type PiecePicture = typeof PiecePicture.Type

/** A piece's turn (owner, 2026-10-30): its clean picture on a wooden hanger turning from the side to the front, made
 * on request for credits. `making` while the video model works; `building` while the owner's browser cuts the video
 * into frames; `ready` with the frame sheet's layout; `failed` when no turn came of it (its credits came back). */
export const TurnState = Schema.Literals(['making', 'building', 'ready', 'failed'])
export type TurnState = typeof TurnState.Type

/** How a turn's frame sheet is laid out: `frames` cells of `width` by `height` in `columns`, the hanger's apex at
 * `pivot` (fractions of a cell). */
export const TurnLayout = Schema.Struct({
  frames: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 60 })),
  columns: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  width: Schema.Int.check(Schema.isBetween({ minimum: 32, maximum: 1024 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 32, maximum: 1024 })),
  pivot: Schema.Tuple([Schema.Number, Schema.Number]),
})
export type TurnLayout = typeof TurnLayout.Type

export const PieceTurn = Schema.Struct({
  state: TurnState,
  /** Changes with every new turn and sheet; turn addresses carry it. */
  version: Schema.Int,
  layout: Schema.optionalKey(TurnLayout),
})
export type PieceTurn = typeof PieceTurn.Type

/** The frame sheet the owner's browser cut from a turn's video: a PNG, base64, laid out as `layout` says. At most
 * 12 MB of base64, about 9 MB of PNG. */
export const TurnSheet = Schema.Struct({
  operationId: OperationId,
  layout: TurnLayout,
  sheet: Schema.String.check(Schema.isMaxLength(12 * 1024 * 1024)),
})

/** A frame sheet that is not a PNG laid out as it says, or a turn with no clean picture left to check it against. */
export class SheetRefused extends Schema.TaggedError<SheetRefused>()(
  'SheetRefused',
  {},
  {
    httpApiStatus: 422,
    guide: refusal('sheet_refused', 'That frame sheet does not match its layout.', 'Ask for a new turn.'),
  },
) {}

/** Show the drawing or the photo: `PUT /api/pieces/:pieceId/picture`. */
export const ChoosePicture = Schema.Struct({ operationId: OperationId, use: PictureChoice })

/** Ask for a new drawing of a piece, for a credit (owner, 2026-10-30). A new `operationId` for each request; repeating
 * one answers the first request again instead of drawing twice. */
export const RedrawPicture = Schema.Struct({ operationId: OperationId, hint: Schema.optionalKey(Hint) })
export type RedrawPicture = typeof RedrawPicture.Type

export const Piece = Schema.Struct({
  id: PieceId,
  name: Schema.NullOr(Name),
  notes: Schema.NullOr(Notes),
  type: PieceType,
  colours: Colours,
  season: Schema.NullOr(Season),
  occasions: Occasions,
  pattern: Schema.NullOr(Pattern),
  brand: Schema.NullOr(Brand),
  shopUrl: Schema.NullOr(ShopUrl),
  /** Whether a picture of its back is kept: the held camera's back shot, or one the person added. */
  hasBack: Schema.Boolean,
  status: PieceStatus,
  source: PieceSource,
  /** ISO 8601 instants. */
  createdAt: Schema.String,
  updatedAt: Schema.String,
  /** Absent for a piece no drawing was ever asked for. */
  picture: Schema.optionalKey(PiecePicture),
  /** Absent for a piece never asked to turn. */
  turn: Schema.optionalKey(PieceTurn),
})
export type Piece = typeof Piece.Type

export const Pieces = Schema.Struct({ pieces: Schema.Array(Piece) })

export const CreateUpload = Schema.Struct({
  operationId: OperationId,
  contentType: ImageType,
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maximumImageBytes })),
})

/** An upload for a wardrobe video, streamed rather than read whole. */
export const CreateVideoUpload = Schema.Struct({
  operationId: OperationId,
  contentType: VideoType,
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maximumVideoBytes })),
})

/** Where to send the photo's bytes: `PUT` the exact `path`, with the declared content type and
 * length, before `expiresAt`. The path carries a one-time token, so treat it as a secret. */
export const Upload = Schema.Struct({ uploadId: UploadId, path: Schema.String, expiresAt: Schema.String })

/** A piece's details as a person or an assistant gives them. */
const pieceDetails = {
  colours: Schema.optionalKey(Colours),
  name: Schema.optionalKey(Name),
  season: Schema.optionalKey(Season),
  occasions: Schema.optionalKey(Occasions),
  pattern: Schema.optionalKey(Pattern),
  brand: Schema.optionalKey(Brand),
  shopUrl: Schema.optionalKey(ShopUrl),
}

export const AddPiece = Schema.Struct({
  operationId: OperationId,
  uploadId: UploadId,
  type: PieceType,
  ...pieceDetails,
})
export type AddPiece = typeof AddPiece.Type

/** A piece's fields to change; fields left out stay, and null clears a field that may be empty. */
export const PieceChanges = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Name)),
  notes: Schema.optionalKey(Schema.NullOr(Notes)),
  type: Schema.optionalKey(PieceType),
  colours: Schema.optionalKey(Colours),
  season: Schema.optionalKey(Schema.NullOr(Season)),
  occasions: Schema.optionalKey(Occasions),
  pattern: Schema.optionalKey(Schema.NullOr(Pattern)),
  brand: Schema.optionalKey(Schema.NullOr(Brand)),
  shopUrl: Schema.optionalKey(Schema.NullOr(ShopUrl)),
})
export type PieceChanges = typeof PieceChanges.Type

/** Change a piece: `PATCH /api/pieces/:pieceId`. */
export const UpdatePiece = Schema.Struct({ operationId: OperationId, ...PieceChanges.fields })
export type UpdatePiece = typeof UpdatePiece.Type

/** A photo of the piece's back: `PUT /api/pieces/:pieceId/back`, cut out like the front, for a photo's credit. A new
 * `operationId` each time; repeating one answers the first request again. */
export const SetBack = Schema.Struct({ operationId: OperationId, uploadId: UploadId })
export type SetBack = typeof SetBack.Type

const UploadRefusal = Schema.Literals([
  'notFound',
  'expired',
  'notReceived',
  'alreadyUsed',
  'tooLarge',
  'notAnImage',
  'wrongType',
  'tooLong',
])

/** A photo or video Styld will not take, and why. `tooLong` is a video over a minute. */
export class UploadRefused extends Schema.TaggedError<UploadRefused>()(
  'UploadRefused',
  { reason: UploadRefusal },
  {
    httpApiStatus: 422,
    guide: byCase<typeof UploadRefusal.Type>('reason', {
      notFound: refusal(
        'photo_refused',
        'That upload does not exist or belongs to someone else.',
        'Call upload_create for a new upload.',
      ),
      expired: refusal(
        'photo_refused',
        'That upload expired before the photo arrived.',
        'Call upload_create again and PUT the photo within 15 minutes.',
      ),
      notReceived: refusal(
        'photo_refused',
        'The photo for that upload has not arrived yet.',
        'PUT the photo bytes to the upload URL, then call the tool again.',
      ),
      alreadyUsed: refusal(
        'photo_refused',
        'That upload was already used.',
        'Call piece_search to find what it became, or upload a new photo.',
      ),
      tooLarge: refusal('photo_refused', 'The photo is larger than 15 MB.', 'Use a smaller photo.'),
      notAnImage: refusal(
        'photo_refused',
        'The file is not a JPEG, PNG, WebP, AVIF or GIF image.',
        'Use a photo in one of those formats.',
      ),
      wrongType: refusal(
        'photo_refused',
        'The photo is not the type the upload declared.',
        'Create the upload with the photo’s real content type.',
      ),
      tooLong: refusal('photo_refused', 'The video is longer than a minute.', 'Use a clip of a minute or less.'),
    }),
  },
) {}

const PictureRefusal = Schema.Literals(['photo', 'face', 'busy'])

/** Why a piece cannot be drawn now: it shows its original photo, which never leaves Styld (`photo`); a face may show
 * in it (`face`); or a drawing is already being made (`busy`). */
export class PictureRefused extends Schema.TaggedError<PictureRefused>()(
  'PictureRefused',
  { reason: PictureRefusal },
  {
    httpApiStatus: 409,
    guide: byCase<typeof PictureRefusal.Type>('reason', {
      photo: refusal(
        'picture_refused',
        'That piece shows its original photo, which Styld never sends to an image model.',
        'Tell the person; a new capture of the piece gives it a cut-out that can be drawn.',
      ),
      face: refusal(
        'picture_refused',
        'A face may show in that piece’s cut-out, so Styld does not send it to an image model.',
        'Tell the person; a new capture without a face in view can be drawn.',
      ),
      busy: passing(
        'picture_refused',
        'A drawing of that piece is already being made.',
        'Wait about a minute, then read its picture with piece_get.',
      ),
    }),
  },
) {}

const TurnRefusal = Schema.Literals(['picture', 'busy'])

/** Why a piece cannot turn now: it has no clean picture to turn (`picture`), or a turn is already being made
 * (`busy`). */
export class TurnRefused extends Schema.TaggedError<TurnRefused>()(
  'TurnRefused',
  { reason: TurnRefusal },
  {
    httpApiStatus: 409,
    guide: byCase<typeof TurnRefusal.Type>('reason', {
      picture: refusal('turn_refused', 'That piece has no clean picture to turn.', 'Redraw its picture first.'),
      busy: passing('turn_refused', 'A turn of that piece is already being made.', 'Wait, then read the piece again.'),
    }),
  },
) {}

/** The piece has no clean drawing to show or choose: none was made, or it was dropped. */
export class NoCleanPicture extends Schema.TaggedError<NoCleanPicture>()(
  'NoCleanPicture',
  {},
  {
    httpApiStatus: 409,
    guide: refusal('no_clean_picture', 'That piece has no clean drawing to show.', 'Redraw its picture first.'),
  },
) {}
