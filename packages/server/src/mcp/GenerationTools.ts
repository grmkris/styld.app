import {
  type BoardNotFound,
  BoardId,
  type CaptureUnavailable,
  type DailyLimitReached,
  Generate,
  GenerationId,
  type GenerationNotFound,
  type OperationConflict,
  type PromptRefused,
} from '@styld/protocol'
import { Effect, Match, Schema } from 'effect'
import type { Generations } from '../generation/Service.ts'
import { paced } from './Pacing.ts'
import { tool, ToolError } from './Tools.ts'

type GenerationFailure =
  | BoardNotFound
  | PromptRefused
  | DailyLimitReached
  | OperationConflict
  | CaptureUnavailable
  | GenerationNotFound

const refused = (code: string, message: string, recovery: string) =>
  new ToolError({ code, message, recovery, retryable: false })

/** Every generation refusal as a tool error the assistant can act on. */
const asToolError = (error: GenerationFailure): ToolError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      BoardNotFound: () => refused('board_not_found', 'There is no such board in the wardrobe.', 'Use board_list.'),
      GenerationNotFound: () => refused('not_found', 'There is no such generation.', 'Use the id a generation gave.'),
      PromptRefused: ({ reason }) =>
        refused('prompt_refused', `Styld does not make that (${reason}).`, 'Ask the person for other words.'),
      DailyLimitReached: ({ resetsAt }) =>
        new ToolError({
          code: 'daily_limit',
          message: `Today's free credits are spent; they come back at ${resetsAt}.`,
          recovery: 'Try again after then.',
          retryable: true,
        }),
      OperationConflict: () =>
        refused('operation_conflict', 'That operationId was used for something else.', 'Choose a new operationId.'),
      CaptureUnavailable: () =>
        new ToolError({
          code: 'unavailable',
          message: 'Styld could not do that just now.',
          recovery: 'Try again in a moment.',
          retryable: true,
        }),
    }),
  )

const shown = (origin: string) => (generation: { readonly boardId: string }) => ({
  ...generation,
  boardUrl: `${origin}/boards/${generation.boardId}`,
})

const Ask = Schema.Struct({ boardId: BoardId, ...Generate.fields })

/** Pictures Styld makes for a board, at one credit each from the daily allowance, marked Generated. */
export const generationTools = (generations: Pick<Generations['Service'], 'admit' | 'get'>, origin: string) => {
  const show = shown(origin)
  return [
    tool({
      name: 'picture_generate',
      title: 'Make a picture for a board',
      description:
        'Make one picture from the person’s words and pin it on their board, marked Generated; it costs one credit. It is drawn in the background: read it with generation_get. No real person’s likeness. Choose a new `operationId` for each picture.',
      parameters: Ask,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ boardId, ...input }) =>
        paced('generate')(
          generations.admit('picture', boardId, input).pipe(Effect.map(show), Effect.mapError(asToolError)),
        ),
    }),
    tool({
      name: 'moodboard_make',
      title: 'Make a mood board',
      description:
        'From one sentence, Styld makes two to four pictures for the board, pins the person’s pieces that suit it, and lays the collage out; each picture costs one credit, and unused credits go back. It runs in the background: read it with generation_get, then board_get. Choose a new `operationId`.',
      parameters: Ask,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ boardId, ...input }) =>
        paced('generate')(
          generations.admit('moodBoard', boardId, input).pipe(Effect.map(show), Effect.mapError(asToolError)),
        ),
    }),
    tool({
      name: 'generation_get',
      title: 'How a generation is going',
      description:
        'Where a picture or mood board stands: planning, drawing, arranging, done, or why it stopped, with each picture’s image id once it is on the board.',
      parameters: Schema.Struct({ generationId: GenerationId }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: ({ generationId }) => generations.get(generationId).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
  ]
}
