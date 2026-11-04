import { maximumColours, maximumImageBytes, maximumVideoBytes, piecesAtOnce } from './Limits.ts'
import { CategoryName, Hint, Name, Notes } from './Text.ts'
import { entityId, OperationId } from './Ids.ts'
import { Schema } from 'effect'
import { byCase, passing, refusal } from './Errors.ts'
import { Brand, Occasions, Pattern, PieceType, Seasons, ShopUrl } from './Garment.ts'

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

/** A piece image's durable quarter-turn correction. Legacy imports default to the original orientation. */
export const PieceRotation = Schema.Literals([0, 90, 180, 270])
export type PieceRotation = typeof PieceRotation.Type

/** Who added the piece: the person on the website, an assistant on their behalf, or Styld bringing their wardrobe over
 * from the first Styld (`tools/import-v1`). */
export const PieceSource = Schema.Literals(['website', 'assistant', 'import'])

/** A piece's clean picture (owner, 2026-10-30): an image model's drawing of the garment from its kept cut-out, shown
 * by default with the real photo one swipe away (owner, 2026-11-04) and marked as AI-cleaned. `drawing` while it is
 * made; `ready` once it is drawn (owner, 2026-11-04: never checked against the cut-out); `retake` when the cut-out shows too little of the garment; `kept` when its
 * photo stays (no cut-out to draw from, or, before 4 November, a face may have shown); `failed` when no drawing came of it. */
export const PictureState = Schema.Literals(['drawing', 'ready', 'retake', 'kept', 'failed'])
export type PictureState = typeof PictureState.Type

/** Which picture a piece shows: the clean drawing or the person's own photo. */
export const PictureChoice = Schema.Literals(['clean', 'photo'])
export type PictureChoice = typeof PictureChoice.Type

export const PiecePicture = Schema.Struct({
  state: PictureState,
  shows: PictureChoice,
  /** Counts drawings; image addresses carry it, so a new drawing is never served from a cache. */
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** The clockwise quarter-turn the drawing is served with, the piece's rotation past the one it was drawn at; the
   * browser gives it to the turn made from the drawing, served as it was made. None is 0. */
  rotation: Schema.optionalKey(PieceRotation),
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
  /** Signed owner-only addresses for the turn's files, when the reader is the website browser. */
  media: Schema.optionalKey(
    Schema.Struct({
      video: Schema.optionalKey(Schema.String),
      front: Schema.optionalKey(Schema.String),
      sheet: Schema.optionalKey(Schema.String),
    }),
  ),
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

/** Where the owner's browser loads a piece's pictures: signed addresses that need no session, each good for about a
 * day and the same for an hour at a time. `thumb` and `full` are the picture it shows; `clean` its drawing, `back` its back, when it has them. On the piece's own page (owner, 4 November 2026: the pictures swipe
 * one to the next) also `photo`, the person's own photo it came from, and `cutout`, the plain cut-out, when it was cut
 * out. */
export const PieceImages = Schema.Struct({
  thumb: Schema.String,
  full: Schema.String,
  clean: Schema.optionalKey(Schema.String),
  back: Schema.optionalKey(Schema.String),
  /** Its back drawn pressed from the back the person photographed, on its own page (owner, 4 November). */
  backClean: Schema.optionalKey(Schema.String),
  photo: Schema.optionalKey(Schema.String),
  cutout: Schema.optionalKey(Schema.String),
})
export type PieceImages = typeof PieceImages.Type

export const Piece = Schema.Struct({
  id: PieceId,
  name: Schema.NullOr(Name),
  notes: Schema.NullOr(Notes),
  type: PieceType,
  colours: Colours,
  /** The seasons it is worn in; none is all year. */
  seasons: Seasons,
  /** Made for rain: a rain jacket, wellies (T-12). */
  rainproof: Schema.Boolean,
  /** The person's own category under its type, if they gave it one: it shows as a card of its own (T-12). */
  category: Schema.NullOr(CategoryName),
  occasions: Occasions,
  pattern: Schema.NullOr(Pattern),
  brand: Schema.NullOr(Brand),
  shopUrl: Schema.NullOr(ShopUrl),
  /** Whether a picture of its back is kept: the held camera's back shot, or one the person added. */
  hasBack: Schema.Boolean,
  /** A clockwise quarter-turn the person's photo and cut-out are delivered with; the drawing, made from the turned
   * cut-out, turns by what it is past the rotation it was drawn at (`PiecePicture.rotation`); the back never turns. */
  rotation: PieceRotation,
  status: PieceStatus,
  source: PieceSource,
  /** ISO 8601 instants. */
  createdAt: Schema.String,
  updatedAt: Schema.String,
  /** Absent for a piece no drawing was ever asked for. */
  picture: Schema.optionalKey(PiecePicture),
  /** Absent for a piece never asked to turn. */
  turn: Schema.optionalKey(PieceTurn),
  /** Only the website's browser is handed them; an assistant never gets an address of a picture. */
  images: Schema.optionalKey(PieceImages),
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
  seasons: Schema.optionalKey(Seasons),
  rainproof: Schema.optionalKey(Schema.Boolean),
  category: Schema.optionalKey(CategoryName),
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
  seasons: Schema.optionalKey(Seasons),
  rainproof: Schema.optionalKey(Schema.Boolean),
  /** The person's own category under the piece's type; null takes it out of one. */
  category: Schema.optionalKey(Schema.NullOr(CategoryName)),
  occasions: Schema.optionalKey(Occasions),
  pattern: Schema.optionalKey(Schema.NullOr(Pattern)),
  brand: Schema.optionalKey(Schema.NullOr(Brand)),
  shopUrl: Schema.optionalKey(Schema.NullOr(ShopUrl)),
  rotation: Schema.optionalKey(PieceRotation),
})
export type PieceChanges = typeof PieceChanges.Type

/** Change a piece: `PATCH /api/pieces/:pieceId`. */
export const UpdatePiece = Schema.Struct({ operationId: OperationId, ...PieceChanges.fields })
export type UpdatePiece = typeof UpdatePiece.Type

/** Delete several pieces at once: `POST /api/pieces/delete`, for good, as deleting one does. A piece already deleted
 * is skipped; another account's refuses the whole delete. Repeating the `operationId` answers the first request. */
export const DeletePieces = Schema.Struct({
  operationId: OperationId,
  pieceIds: Schema.Array(PieceId).check(Schema.isMinLength(1), Schema.isMaxLength(piecesAtOnce)),
})
export type DeletePieces = typeof DeletePieces.Type

/** A photo of the piece's back: `PUT /api/pieces/:pieceId/back`, cut out like the front, free (owner, 4 November). A new
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

const PictureRefusal = Schema.Literals(['photo', 'busy'])

/** Why a piece cannot be drawn now: it shows its original photo, which never leaves Styld (`photo`); or a drawing is
 * already being made (`busy`). */
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

/** Rename one of the person's categories under a type: every piece in it moves to the new name, joining a category
 * already called so (`PATCH /api/categories`). */
export const RenameCategory = Schema.Struct({
  operationId: OperationId,
  type: PieceType,
  name: CategoryName,
  to: CategoryName,
})
export type RenameCategory = typeof RenameCategory.Type

/** Delete one of the person's categories under a type: its pieces stay, under the type alone (`DELETE
 * /api/categories`). */
export const DeleteCategory = Schema.Struct({ operationId: OperationId, type: PieceType, name: CategoryName })
export type DeleteCategory = typeof DeleteCategory.Type
