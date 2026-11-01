import { PieceId, RedrawPicture } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import type { Captures } from '../capture/Service.ts'
import { tool } from './Tools.ts'

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
      captures
        .redrawPicture(pieceId, input)
        .pipe(Effect.map((picture) => ({ pieceId, picture, url: `${origin}/wardrobe/${pieceId}` }))),
  }),
]
