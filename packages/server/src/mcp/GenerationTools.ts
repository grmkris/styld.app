import { BoardId, Generate, GenerationId, prices } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import type { Generations } from '../generation/Service.ts'
import { paced } from './Pacing.ts'
import { creditsText, tool } from './Tools.ts'

const shown = (origin: string) => (generation: { readonly boardId: string }) => ({
  ...generation,
  boardUrl: `${origin}/boards/${generation.boardId}`,
})

const Ask = Schema.Struct({ boardId: BoardId, ...Generate.fields })

/** What Styld makes for a board, at its price from the daily allowance: stickers, marked Generated, and mood
 * boards of the person's own pieces. */
export const generationTools = (generations: Pick<Generations['Service'], 'admit' | 'get'>, origin: string) => {
  const show = shown(origin)
  return [
    tool({
      name: 'sticker_make',
      title: 'Make a sticker for a board',
      description: `Make one small decorative sticker (an object or motif, with a transparent background) from the person’s words and pin it on their board, marked Generated; it costs ${creditsText(prices.sticker)}. It is drawn in the background: read it with generation_get. Never a garment to wear, a person or text. Choose a new \`operationId\` for each sticker.`,
      parameters: Ask,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ boardId, ...input }) =>
        paced('generate')(generations.admit('sticker', boardId, input).pipe(Effect.map(show))),
    }),
    tool({
      name: 'moodboard_make',
      title: 'Make a mood board',
      description: `From one sentence, Styld picks the person’s own pieces that carry the mood, pins them on the board and lays the collage out; it costs ${creditsText(prices.moodBoard)}, given back when the wardrobe holds too little for the sentence. It runs in the background: read it with generation_get, then board_get. Choose a new \`operationId\`.`,
      parameters: Ask,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ boardId, ...input }) =>
        paced('generate')(generations.admit('moodBoard', boardId, input).pipe(Effect.map(show))),
    }),
    tool({
      name: 'generation_get',
      title: 'How a generation is going',
      description:
        'Where a sticker or mood board stands: planning, drawing, arranging, done, or why it stopped, with the sticker’s image id once it is on the board.',
      parameters: Schema.Struct({ generationId: GenerationId }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: ({ generationId }) => generations.get(generationId).pipe(Effect.map(show)),
    }),
  ]
}
