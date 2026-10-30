import {
  type CaptureUnavailable,
  type DailyLimitReached,
  PieceId,
  type PieceNotFound,
  type PictureRefused,
  RedrawPicture,
} from '@styld/protocol'
import { Effect, Match, Schema } from 'effect'
import type { Captures } from '../capture/Service.ts'
import { tool, ToolError } from './Tools.ts'

const refusals: Readonly<Record<PictureRefused['reason'], { message: string; recovery: string }>> = {
  photo: {
    message: 'That piece shows its original photo, which Styld never sends to an image model.',
    recovery: 'Tell the person; a new capture of the piece gives it a cut-out that can be drawn.',
  },
  face: {
    message: 'A face may show in that piece’s cut-out, so Styld does not send it to an image model.',
    recovery: 'Tell the person; a new capture without a face in view can be drawn.',
  },
  busy: {
    message: 'A drawing of that piece is already being made.',
    recovery: 'Wait about a minute, then read its picture with piece_get.',
  },
  off: {
    message: 'Clean pictures are switched off on this Styld.',
    recovery: 'Tell the person; the piece keeps its photo.',
  },
}

/** Every refusal of a redraw as a tool error the assistant can act on. */
const asToolError = (error: PieceNotFound | PictureRefused | DailyLimitReached | CaptureUnavailable): ToolError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      PieceNotFound: () =>
        new ToolError({
          code: 'not_found',
          message: 'There is no piece with that id in this wardrobe.',
          recovery: 'Call piece_search to find the piece.',
          retryable: false,
        }),
      PictureRefused: ({ reason }) => new ToolError({ code: 'picture_refused', ...refusals[reason], retryable: false }),
      DailyLimitReached: ({ resetsAt }) =>
        new ToolError({
          code: 'daily_limit',
          message: 'Today’s credits are used up.',
          recovery: `Try again after ${resetsAt}.`,
          retryable: false,
        }),
      CaptureUnavailable: () =>
        new ToolError({
          code: 'unavailable',
          message: 'Styld could not ask for the drawing just now.',
          recovery: 'Try again in a moment with the same operationId.',
          retryable: true,
        }),
    }),
  )

/** Clean pictures: a thin projection of the same redraw the website asks for. */
export const pictureTools = (captures: Pick<Captures['Service'], 'redrawPicture'>, origin: string) => [
  tool({
    name: 'picture_redraw',
    title: 'Redraw a piece’s clean picture',
    description:
      'Ask Styld to draw the clean product picture of a piece again from its cut-out, for 1 credit, refunded if no picture comes of it. A `hint` of up to 80 characters says what the piece is ("a black wool beanie") when the last drawing got it wrong. Choose a new `operationId` for each request; repeating one answers the first request instead of drawing twice. Drawing takes about a minute; piece_get then shows `picture.state`. The person’s own photo stays one tap away on the website.',
    parameters: Schema.Struct({ pieceId: PieceId, ...RedrawPicture.fields }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: ({ pieceId, ...input }) =>
      captures.redrawPicture(pieceId, input).pipe(
        Effect.map((picture) => ({ pieceId, picture, url: `${origin}/wardrobe/${pieceId}` })),
        Effect.mapError(asToolError),
      ),
  }),
]
