import { PieceId, RedrawPicture, textLength } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import type { Captures } from '../capture/Service.ts'
import { tool } from './Tools.ts'

/** Clean pictures: a thin projection of the same redraw the website asks for. */
export const pictureTools = (captures: Pick<Captures['Service'], 'redrawPicture'>, origin: string) => [
  tool({
    name: 'picture_redraw',
    title: 'Redraw a piece’s clean picture',
    description: `Ask Styld to draw the clean product picture of a piece again from its cut-out, free. A \`hint\` of up to ${String(textLength.hint)} characters says what to correct when the last drawing got it wrong ("keep the crossed straps on the back", "it is a black wool beanie"); it comes before every other instruction. Choose a new \`operationId\` for each request; repeating one answers the first request instead of drawing twice. Drawing takes about a minute; piece_get then shows \`picture.state\`, and piece_show shows its pictures. The person’s own photo stays one tap away on the website.`,
    parameters: Schema.Struct({ pieceId: PieceId, ...RedrawPicture.fields }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: ({ pieceId, ...input }) =>
      captures
        .redrawPicture(pieceId, input)
        .pipe(Effect.map((picture) => ({ pieceId, picture, url: `${origin}/wardrobe/${pieceId}` }))),
  }),
]
