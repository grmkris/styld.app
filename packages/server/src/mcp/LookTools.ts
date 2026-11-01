import { CreateLook, type Look, LookId, maximumLookPieces } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import type { Looks } from '../looks/Looks.ts'
import { tool } from './Tools.ts'

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
      handler: (input) => looks.createLook(input).pipe(Effect.map(show)),
    }),
    tool({
      name: 'look_list',
      title: 'Saved looks',
      description: 'The looks saved for this account, newest first, each with its pieces and its link on the website.',
      parameters: Schema.Struct({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: () => looks.listLooks().pipe(Effect.map((found) => ({ looks: found.map(show) }))),
    }),
    tool({
      name: 'look_get',
      title: 'One look',
      description: 'One saved look by its id, with its pieces.',
      parameters: Schema.Struct({ lookId: LookId }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: ({ lookId }) => looks.getLook(lookId).pipe(Effect.map(show)),
    }),
    tool({
      name: 'look_share',
      title: 'Share a look or stop sharing it',
      description:
        'Share a saved look on the person’s published profile, or stop sharing it. Only when the person asks. Styld checks a shared look before others see it; `check.state` says where that stands.',
      parameters: Schema.Struct({ lookId: LookId, shared: Schema.Boolean }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ lookId, shared }) => looks.shareLook(lookId, { shared }).pipe(Effect.map(show)),
    }),
    tool({
      name: 'look_delete',
      title: 'Delete a look',
      description: 'Delete a saved look. Its pieces stay in the wardrobe. Ask the person first.',
      parameters: Schema.Struct({ lookId: LookId }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      handler: ({ lookId }) => looks.deleteLook(lookId).pipe(Effect.as({ deleted: true, lookId })),
    }),
  ]
}
