import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Generations } from './Service.ts'

/** The website's generation endpoints: asking for stickers and mood boards, and reading how they go. */
export const generationHandlers = HttpApiBuilder.group(StyldApi, 'generation', (handlers) =>
  Effect.map(Generations, (generations) =>
    handlers
      .handle('makeSticker', ({ params, payload }) => generations.admit('sticker', params.boardId, payload))
      .handle('makeMoodBoard', ({ params, payload }) => generations.admit('moodBoard', params.boardId, payload))
      .handle('generation', ({ params }) => generations.get(params.generationId))
      .handle('runningGeneration', ({ params }) => generations.running(params.boardId)),
  ),
)
