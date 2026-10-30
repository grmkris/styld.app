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

/** Every message the Worker's queue carries. */
export const WorkMessage = Schema.Union([ProcessPiece, FinishAccountDeletion, ProcessCapture, CleanPicture, MakeTurn])
export type WorkMessage = typeof WorkMessage.Type

/** The cut-out step could not produce an image this time; the queue retries it. */
export class CutoutFailed extends Schema.TaggedError<CutoutFailed>()('CutoutFailed', {}) {}

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
    }) => Effect.Effect<{ readonly imageKey: string }, CutoutFailed>
    /** The queue gave up on the piece: anything `cut` held for it is let go. */
    readonly release: (input: {
      readonly accountId: string
      readonly pieceId: string
    }) => Effect.Effect<void, CutoutFailed>
  }
>()('@styld/server/GarmentCutout') {
  static readonly keepOriginal = Layer.succeed(this, {
    cut: ({ originalKey }) => Effect.succeed({ imageKey: originalKey }),
    release: () => Effect.void,
  })
}
