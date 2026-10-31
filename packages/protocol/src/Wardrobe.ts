import { Schema } from 'effect'
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
export const Colours = Schema.Array(Colour).check(Schema.isUnique(), Schema.isMaxLength(6))

/** Opaque ids: a kind prefix and 22 base64url characters (16 random bytes). */
export const PieceId = Schema.String.check(Schema.isPattern(/^pc_[A-Za-z0-9_-]{22}$/)).pipe(Schema.brand('PieceId'))
export type PieceId = typeof PieceId.Type
export const UploadId = Schema.String.check(Schema.isPattern(/^up_[A-Za-z0-9_-]{22}$/)).pipe(Schema.brand('UploadId'))
export type UploadId = typeof UploadId.Type

/** Chosen by the caller once per intended change; repeating it repeats the answer, never the change. */
export const OperationId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/)).pipe(
  Schema.brand('OperationId'),
)
export type OperationId = typeof OperationId.Type

/** Photos Styld accepts. HEIC is not among them yet: browsers convert it to JPEG on upload. */
export const ImageType = Schema.Literals(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
export type ImageType = typeof ImageType.Type

export const maximumImageBytes = 15 * 1024 * 1024

/** A wardrobe video: the containers phones record and Meta SAM reads. */
export const VideoType = Schema.Literals(['video/mp4', 'video/quicktime'])
export type VideoType = typeof VideoType.Type

/** The most a Worker request carries is 100 MB; a minute of 1080p phone video fits under this. */
export const maximumVideoBytes = 95 * 1024 * 1024

const Name = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))
const Notes = Schema.String.check(Schema.isMaxLength(500))

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

/** Ask for a turn: `POST /api/pieces/:pieceId/turn`, a new `operationId` each time. */
export const MakeTurn = Schema.Struct({ operationId: OperationId })

/** The frame sheet the owner's browser cut from a turn's video: a PNG, base64, laid out as `layout` says. At most
 * 12 MB of base64, about 9 MB of PNG. */
export const TurnSheet = Schema.Struct({
  layout: TurnLayout,
  sheet: Schema.String.check(Schema.isMaxLength(12 * 1024 * 1024)),
})

/** A frame sheet that is not a PNG laid out as it says, or a turn with no clean picture left to check it against. */
export class SheetRefused extends Schema.TaggedError<SheetRefused>()('SheetRefused', {}, { httpApiStatus: 422 }) {}

/** Show the drawing or the photo: `PUT /api/pieces/:pieceId/picture`. */
export const ChoosePicture = Schema.Struct({ use: PictureChoice })

/** The owner's own words about a piece for its next drawing, such as "a black wool beanie". */
const Hint = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))

/** Ask for a new drawing of a piece, for a credit (owner, 2026-10-30). A new `operationId` for each request; repeating
 * one answers the first request again instead of drawing twice. */
export const RedrawPicture = Schema.Struct({ operationId: OperationId, hint: Schema.optionalKey(Hint) })
export type RedrawPicture = typeof RedrawPicture.Type

/** Pieces with no clean picture yet that one could be drawn for, or that were just queued for one. */
export const PictureBackfill = Schema.Struct({ pieces: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })

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
  contentType: ImageType,
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maximumImageBytes })),
})

/** An upload for a wardrobe video, streamed rather than read whole. */
export const CreateVideoUpload = Schema.Struct({
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

/** Change a piece; fields left out stay, and null clears a field that may be empty. */
export const UpdatePiece = Schema.Struct({
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
export type UpdatePiece = typeof UpdatePiece.Type

/** A photo of the piece's back: `PUT /api/pieces/:pieceId/back`, cut out like the front, for a photo's credit. A new
 * `operationId` each time; repeating one answers the first request again. */
export const SetBack = Schema.Struct({ operationId: OperationId, uploadId: UploadId })
export type SetBack = typeof SetBack.Type

export class PieceNotFound extends Schema.TaggedError<PieceNotFound>()('PieceNotFound', {}, { httpApiStatus: 404 }) {}

/** A photo or video Styld will not take, and why. `tooLong` is a video over a minute. */
export class UploadRefused extends Schema.TaggedError<UploadRefused>()(
  'UploadRefused',
  {
    reason: Schema.Literals([
      'notFound',
      'expired',
      'notReceived',
      'alreadyUsed',
      'tooLarge',
      'notAnImage',
      'wrongType',
      'tooLong',
    ]),
  },
  { httpApiStatus: 422 },
) {}

/** Why a piece cannot be drawn now: it shows its original photo, which never leaves Styld (`photo`); a face may show
 * in it (`face`); a drawing is already being made (`busy`); or clean pictures are off (`off`). */
export class PictureRefused extends Schema.TaggedError<PictureRefused>()(
  'PictureRefused',
  { reason: Schema.Literals(['photo', 'face', 'busy', 'off']) },
  { httpApiStatus: 409 },
) {}

/** Why a piece cannot turn now: it has no clean picture to turn (`picture`), a turn is already being made (`busy`),
 * or turns are off (`off`). */
export class TurnRefused extends Schema.TaggedError<TurnRefused>()(
  'TurnRefused',
  { reason: Schema.Literals(['picture', 'busy', 'off']) },
  { httpApiStatus: 409 },
) {}

/** The piece has no clean drawing to show or choose: none was made, or it was dropped. */
export class NoCleanPicture extends Schema.TaggedError<NoCleanPicture>()(
  'NoCleanPicture',
  {},
  { httpApiStatus: 409 },
) {}

/** The operation id was already used for a different change. */
export class OperationConflict extends Schema.TaggedError<OperationConflict>()(
  'OperationConflict',
  {},
  { httpApiStatus: 409 },
) {}

/** Storage did not answer; the request may be retried. */
export class WardrobeUnavailable extends Schema.TaggedError<WardrobeUnavailable>()(
  'WardrobeUnavailable',
  {},
  { httpApiStatus: 503 },
) {}
