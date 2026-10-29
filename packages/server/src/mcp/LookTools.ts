import {
  CreateLook,
  type Look,
  LookId,
  type LookNotFound,
  maximumLookPieces,
  type OperationConflict,
  type PieceNotFound,
  type WardrobeUnavailable,
} from '@styld/protocol'
import { Effect, Match, Schema } from 'effect'
import type { Looks } from '../looks/Looks.ts'
import { tool, ToolError } from './Tools.ts'

type LookFailure = LookNotFound | PieceNotFound | OperationConflict | WardrobeUnavailable

/** Every look refusal as a tool error the assistant can act on. */
const asToolError = (error: LookFailure): ToolError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      LookNotFound: () =>
        new ToolError({
          code: 'not_found',
          message: 'There is no look with that id for this account.',
          recovery: 'Call look_list to find the look.',
          retryable: false,
        }),
      PieceNotFound: () =>
        new ToolError({
          code: 'piece_not_found',
          message: 'One of those pieces is not in this wardrobe.',
          recovery: 'Call piece_search and use the ids it returns.',
          retryable: false,
        }),
      OperationConflict: () =>
        new ToolError({
          code: 'operation_conflict',
          message: 'That operationId was already used for a different change.',
          recovery: 'Use a new operationId for a new look.',
          retryable: false,
        }),
      WardrobeUnavailable: () =>
        new ToolError({
          code: 'unavailable',
          message: 'Styld could not reach the wardrobe just now.',
          recovery: 'Try again in a moment.',
          retryable: true,
        }),
    }),
  )

/** A look as assistants see it: its pieces and its page on the website, never an image address. */
const shown = (origin: string) => (look: Look) => ({
  ...look,
  url: `${origin}/looks/${look.id}`,
  pieces: look.pieces.map((piece) => ({ ...piece, url: `${origin}/wardrobe/${piece.id}` })),
})

/** Looks: outfits an assistant puts together from the person's own pieces. */
export const lookTools = (looks: Looks['Service'], origin: string) => {
  const show = shown(origin)
  return [
    tool({
      name: 'look_create',
      title: 'Put a look together',
      description: `Save an outfit made of pieces from this wardrobe (1 to ${maximumLookPieces} piece ids from piece_search, in the order to show them), with a name and an optional occasion. Choose a new \`operationId\` for each look; repeating a call with the same one returns the first look.`,
      parameters: CreateLook,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: (input) => looks.createLook(input).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'look_list',
      title: 'Saved looks',
      description: 'The looks saved for this account, newest first, each with its pieces and its link on the website.',
      parameters: Schema.Struct({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: () =>
        looks.listLooks().pipe(
          Effect.map((found) => ({ looks: found.map(show) })),
          Effect.mapError(asToolError),
        ),
    }),
    tool({
      name: 'look_get',
      title: 'One look',
      description: 'One saved look by its id, with its pieces.',
      parameters: Schema.Struct({ lookId: LookId }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: ({ lookId }) => looks.getLook(lookId).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'look_delete',
      title: 'Delete a look',
      description: 'Delete a saved look. Its pieces stay in the wardrobe. Ask the person first.',
      parameters: Schema.Struct({ lookId: LookId }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      handler: ({ lookId }) =>
        looks.deleteLook(lookId).pipe(Effect.as({ deleted: true, lookId }), Effect.mapError(asToolError)),
    }),
  ]
}
