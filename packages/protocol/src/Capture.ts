import { Name } from './Text.ts'
import { entityId, OperationId } from './Ids.ts'
import { Schema } from 'effect'
import { Occasions, Pattern, PieceType, Season } from './Garment.ts'
import { Colours, PieceId, UploadId } from './Wardrobe.ts'

export const CaptureId = entityId('cp').pipe(Schema.brand('CaptureId'))
export type CaptureId = typeof CaptureId.Type
export const DetectionId = entityId('dt').pipe(Schema.brand('DetectionId'))
export type DetectionId = typeof DetectionId.Type

/** Where a capture came from: the phone's picker, Styld's camera, a video, or a shop's product page. */
export const CaptureSource = Schema.Literals(['picker', 'camera', 'video', 'link'])
export type CaptureSource = typeof CaptureSource.Type

/**
 * A photo or video on its way to pieces:
 * - `processing`: being cut out;
 * - `review`: its pieces wait for the person;
 * - `done`: every piece was kept or discarded;
 * - `failed`: it could not be processed (credits returned);
 * - `unknown`: a provider took the work and its answer was lost; it waits for the person to try again.
 */
export const CaptureStatus = Schema.Literals(['processing', 'review', 'done', 'failed', 'unknown'])
export type CaptureStatus = typeof CaptureStatus.Type

/** Which side of a garment the camera saw. A back shot pairs with the front shot before it. */
export const Side = Schema.Literals(['front', 'back', 'unclear'])
export type Side = typeof Side.Type

export const CreateCapture = Schema.Struct({
  operationId: OperationId,
  uploadId: UploadId,
  source: CaptureSource,
  side: Schema.optionalKey(Side),
  pairsWith: Schema.optionalKey(CaptureId),
  /** The first capture of the photos picked with this one: a garment seen in several of them is one card. */
  importOf: Schema.optionalKey(CaptureId),
})
export type CreateCapture = typeof CreateCapture.Type

/** 64 relative sharpness values (8×8 tiles, row by row), each from 0 to 1. */
const Sharpness = Schema.Array(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))).check(
  Schema.isMinLength(64),
  Schema.isMaxLength(64),
)

/** A still the browser sampled from the video, uploaded beside it. */
export const VideoStill = Schema.Struct({
  uploadId: UploadId,
  atMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sharpness: Sharpness,
})

export const CreateVideoCapture = Schema.Struct({
  operationId: OperationId,
  videoUploadId: UploadId,
  durationMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 61_000 })),
  width: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8192 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8192 })),
  stills: Schema.Array(VideoStill).check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  /** The capture of the video's first part, for each later part: a garment seen in several parts is one card. */
  importOf: Schema.optionalKey(CaptureId),
})
export type CreateVideoCapture = typeof CreateVideoCapture.Type

export const CaptureCreated = Schema.Struct({ captureId: CaptureId })

/** What the decision model suggested for a piece; the person confirms or changes it. */
export const Suggestion = Schema.Struct({
  type: Schema.NullOr(PieceType),
  colours: Colours,
  season: Schema.NullOr(Season),
  occasions: Occasions,
  pattern: Schema.NullOr(Pattern),
})

/** One piece found in a capture, waiting for the person. */
export const Detection = Schema.Struct({
  id: DetectionId,
  /** Whether the tray offers it ticked: clothes the person is wearing in a camera shot are not. */
  preselected: Schema.Boolean,
  /** Whether a cut-out exists; without one the original photo is the only picture. */
  hasCutout: Schema.Boolean,
  suggestion: Suggestion,
  /** The back of the same garment, from a camera shot that followed. */
  hasBack: Schema.Boolean,
  /** How many times the import showed this garment: its other sightings, in other parts or photos, are kept or
   * discarded with it. */
  sightings: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  /** The piece of the wardrobe the decision model took this garment for: offered unticked, to keep both or skip. */
  alreadyHave: Schema.optionalKey(PieceId),
  /** Only part of the garment shows: it needs a better look, held up or laid out, before it can be drawn. */
  partial: Schema.optionalKey(Schema.Boolean),
})
export type Detection = typeof Detection.Type

export const TrayCapture = Schema.Struct({
  id: CaptureId,
  source: CaptureSource,
  status: CaptureStatus,
  detections: Schema.Array(Detection),
  createdAt: Schema.String,
})
export type TrayCapture = typeof TrayCapture.Type

/** Every capture still waiting for the person, newest first, and today's free allowance. */
export const Tray = Schema.Struct({
  captures: Schema.Array(TrayCapture),
  allowance: Schema.Struct({ remaining: Schema.Int, daily: Schema.Int }),
})
export type Tray = typeof Tray.Type

/** One piece the person keeps, with the details they confirmed. */
export const Keep = Schema.Struct({
  detectionId: DetectionId,
  type: PieceType,
  colours: Schema.optionalKey(Colours),
  season: Schema.optionalKey(Season),
  occasions: Schema.optionalKey(Occasions),
  pattern: Schema.optionalKey(Pattern),
  name: Schema.optionalKey(Name),
  /** Keep the original photo instead of the cut-out. */
  useOriginal: Schema.optionalKey(Schema.Boolean),
})
export type Keep = typeof Keep.Type

export const Review = Schema.Struct({
  operationId: OperationId,
  keep: Schema.Array(Keep).check(Schema.isMaxLength(200)),
  discard: Schema.Array(DetectionId).check(Schema.isMaxLength(200)),
})
export type Review = typeof Review.Type

export const Reviewed = Schema.Struct({ pieceIds: Schema.Array(PieceId) })
export type Reviewed = typeof Reviewed.Type

/** How the camera sees a garment: held up to it by a person, or laid flat with the phone above. */
export const CameraLayout = Schema.Literals(['held', 'flat'])
export type CameraLayout = typeof CameraLayout.Type

/** The camera asks whether one garment is shown. Frames are small JPEGs, base64 encoded. */
export const HeldCheckRequest = Schema.Struct({
  frame: Schema.String.check(Schema.isMaxLength(400_000)),
  previous: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(400_000))),
  layout: Schema.optionalKey(CameraLayout),
})
export const HeldCheckAnswer = Schema.Struct({
  held: Schema.Boolean,
  side: Side,
  samePrevious: Schema.Boolean,
  /** Whether a person holds it up: a garment lying on a bed behind the camera is not held. */
  holding: Schema.Boolean,
})
export type HeldCheckAnswer = typeof HeldCheckAnswer.Type
