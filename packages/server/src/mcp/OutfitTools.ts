import {
  MakeOutfit,
  mostProposals,
  type OutfitSlowDown,
  type OutfitUnavailable,
  type PieceNotFound,
  type ThinkingSpent,
} from '@styld/protocol'
import { Effect, Match } from 'effect'
import type { Outfits } from '../outfits/Outfits.ts'
import { tool, ToolError } from './Tools.ts'

type OutfitFailure = PieceNotFound | OutfitSlowDown | ThinkingSpent | OutfitUnavailable

/** Every outfit refusal as a tool error the assistant can act on. */
const asToolError = (error: OutfitFailure): ToolError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      PieceNotFound: () =>
        new ToolError({
          code: 'piece_not_found',
          message: 'The anchor or a locked piece is not a ready piece in this wardrobe.',
          recovery: 'Call piece_search and use the ids it returns.',
          retryable: false,
        }),
      OutfitSlowDown: () =>
        new ToolError({
          code: 'slow_down',
          message: 'Too many outfits asked for in a minute.',
          recovery: 'Wait a minute, then try again.',
          retryable: true,
        }),
      ThinkingSpent: () =>
        new ToolError({
          code: 'thinking_spent',
          message: 'Today’s Thinking outfits are spent.',
          recovery: 'Ask again with mode fast.',
          retryable: false,
        }),
      OutfitUnavailable: () =>
        new ToolError({
          code: 'unavailable',
          message: 'No outfit could be made just now.',
          recovery: 'Try again in a moment, or with mode fast.',
          retryable: true,
        }),
    }),
  )

/** Outfits from the person's own pieces: proposals only; a look saves one. */
export const outfitTools = (outfits: Outfits['Service']) => [
  tool({
    name: 'outfit_make',
    title: 'Make outfits',
    description: `Up to ${String(mostProposals)} outfits of pieces in this wardrobe, best first: piece ids in wearing order and a score from a model that looked at them together. \`mode\` fast uses Styld's rules; thinking asks a language model, a limited number of times a day. Optional: \`anchorPieceId\` to build around, \`lockedPieceIds\` to keep, a \`brief\` (season, occasion, words). For more, pass the \`session\` you got and the keys already shown in \`seen\`. \`missing\` names what the wardrobe lacks. Nothing is saved: use look_create.`,
    parameters: MakeOutfit,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input) => outfits.make(input).pipe(Effect.mapError(asToolError)),
  }),
]
