import type { Colour, Occasion, Pattern, PieceType, Season } from '@styld/protocol'
import { Context, Effect, Layer, Option, Schema } from 'effect'

/** Deliveries that run a piece's job before it is given up (`wardrobe/Queue.ts`). */
export const pieceAttempts = 3

/** What the piece queue carries: work on a piece, a capture or an outfit photo, or the end of an account's deletion. */
export const WorkMessage = Schema.TaggedUnion({
  /** Prepare the photo of a newly added piece. */
  ProcessPiece: { pieceId: Schema.String },
  /** Finish deleting an account whose access has already ended. */
  FinishDeletion: { accountId: Schema.String },
  /** Cut a photo or video into the pieces waiting in the tray. */
  ProcessCapture: { captureId: Schema.String },
  /** Draw a kept piece's clean picture, or carry on with one a delivery left. */
  DrawPicture: { pieceId: Schema.String },
  /** Carry a piece's turn on a hanger a step further. */
  MakeTurn: { pieceId: Schema.String },
  /** Compare a capture's new sightings with the rest of its import and with the wardrobe. */
  MatchCapture: { captureId: Schema.String },
  /** Find the garments in an outfit photo (My Gallery). */
  FindGarments: { photoId: Schema.String },
})
export type WorkMessage = typeof WorkMessage.Type

/** The piece queue's producer, as the Worker binds it: every module that queues piece work sends through it. */
export class PieceQueue extends Context.Service<
  PieceQueue,
  { send(message: WorkMessage, options?: { readonly delaySeconds?: number }): Promise<unknown> }
>()('@styld/server/wardrobe/PieceQueue') {
  static readonly layer = (queue: PieceQueue['Service']) => Layer.succeed(this, queue)
}

/** The cut-out step could not produce an image this time; the queue retries it. */
export class CutoutFailed extends Schema.TaggedError<CutoutFailed>()('CutoutFailed', {}) {}

/** Which side of a piece a photo shows: its front, cut out when the piece is added (by the queue delivery `attempt`),
 * paid by the account, or by Styld for a piece imported from v1; or a back the person adds later, cut out from its own
 * upload. */
export type CutSide =
  | { readonly side: 'front'; readonly attempt: number; readonly payer: 'account' | 'styld' }
  | { readonly side: 'back'; readonly uploadId: string }

/** What the decision model takes a piece's cut-out for: its type (and how sure it is of the type's group), colours,
 * season, occasions and pattern. */
export interface PieceDescription {
  readonly type: PieceType | undefined
  readonly confidence: number
  readonly colours: ReadonlyArray<Colour>
  readonly season: Season | undefined
  readonly occasions: ReadonlyArray<Occasion>
  readonly pattern: Pattern | undefined
}

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
    /** What a stored cut-out shows, as the decision model reads it; none when it cannot be read or answered. */
    readonly describe: (cutoutKey: string) => Effect.Effect<Option.Option<PieceDescription>>
  }
>()('@styld/server/GarmentCutout') {
  static readonly keepOriginal = Layer.succeed(this, {
    cut: ({ originalKey }) => Effect.succeed({ imageKey: originalKey }),
    describe: () => Effect.succeedNone,
  })
}
