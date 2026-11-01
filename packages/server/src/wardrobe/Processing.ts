import type { PieceType } from '@styld/protocol'
import { Context, Effect, Layer, Schema } from 'effect'

/** Queue message: prepare the photo of a newly added piece. */
export const ProcessPiece = Schema.Struct({ pieceId: Schema.String })
export type ProcessPiece = typeof ProcessPiece.Type

/** Queue message: finish deleting an account whose access has already ended. */
export const FinishAccountDeletion = Schema.Struct({ finishDeletionOf: Schema.String })

/** Queue message: cut a photo or video into the pieces waiting in the tray. */
export const ProcessCapture = Schema.Struct({ captureId: Schema.String })

/** Queue message: draw a kept piece's clean picture, or carry on with one a delivery left. */
export const CleanPicture = Schema.Struct({ cleanPictureOf: Schema.String })

/** Queue message: carry a piece's turn on a hanger a step further. */
export const MakeTurn = Schema.Struct({ turnOf: Schema.String })

/** Queue message: compare a capture's new sightings with the rest of its import and with the wardrobe. */
export const MatchCapture = Schema.Struct({ matchOf: Schema.String })

/** Queue message: ask the decision model once about a piece carried over from the old categories. */
export const SuggestPiece = Schema.Struct({ suggestFor: Schema.String })

/** Queue message: find the garments in an outfit photo (My Gallery). */
export const FindInPhoto = Schema.Struct({ findIn: Schema.String })

/** Every message the Worker's queue carries. */
export const WorkMessage = Schema.Union([
  ProcessPiece,
  FinishAccountDeletion,
  ProcessCapture,
  CleanPicture,
  MakeTurn,
  MatchCapture,
  SuggestPiece,
  FindInPhoto,
])
export type WorkMessage = typeof WorkMessage.Type

/** The cut-out step could not produce an image this time; the queue retries it. */
export class CutoutFailed extends Schema.TaggedError<CutoutFailed>()('CutoutFailed', {}) {}

/** Which side of a piece a photo shows: its front, cut out when the piece is added (by the queue delivery `attempt`),
 * or a back the person adds later, cut out from its own upload. */
export type CutSide =
  | { readonly side: 'front'; readonly attempt: number }
  | { readonly side: 'back'; readonly uploadId: string }

/** The step that turns a piece's photo into the image the wardrobe shows. The garment cut-out model
 * plugs in here; until then `keepOriginal` shows the photo as it arrived. */
export class GarmentCutout extends Context.Service<
  GarmentCutout,
  {
    readonly cut: (input: {
      readonly accountId: string
      readonly pieceId: string
      readonly originalKey: string
      readonly contentType: string
      /** What the piece is, which tells the cut-out what to look for. */
      readonly type: PieceType
      readonly of: CutSide
    }) => Effect.Effect<{ readonly imageKey: string }, CutoutFailed>
  }
>()('@styld/server/GarmentCutout') {
  static readonly keepOriginal = Layer.succeed(this, {
    cut: ({ originalKey }) => Effect.succeed({ imageKey: originalKey }),
  })
}
