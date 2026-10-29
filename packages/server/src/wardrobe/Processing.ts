import { Context, Effect, Layer, Schema } from 'effect'

/** Queue message: prepare the photo of a newly added piece. */
export const ProcessPiece = Schema.Struct({ pieceId: Schema.String })
export type ProcessPiece = typeof ProcessPiece.Type

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
  }
>()('@styld/server/GarmentCutout') {
  static readonly keepOriginal = Layer.succeed(this, {
    cut: ({ originalKey }) => Effect.succeed({ imageKey: originalKey }),
  })
}
