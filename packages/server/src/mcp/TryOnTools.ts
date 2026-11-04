import {
  AddTryOnToBoard,
  maximumTryOnPieces,
  Operation,
  type Photo,
  prices,
  StartTryOn,
  type TryOn,
  TryOnId,
} from '@styld/protocol'
import { Effect, Schema } from 'effect'
import type { TryOns } from '../generation/TryOn.ts'
import type { Photos } from '../photos/Photos.ts'
import { creditsText, tool, toolSpec } from './Tools.ts'

// Try on for assistants (owner, 4 November 2026): one of the person's own My Gallery photos redrawn by Muse wearing
// pieces of their wardrobe. The assistant asks the person whether the photo shows them before it passes `thisIsMe`;
// it never sees a photo or a result, only ids and Styld's addresses, and shows them with gallery_show and tryon_show.

/** A Gallery photo as assistants see it: when it was taken in, what Styld found in it, and its page. */
const shownPhoto = (origin: string) => (photo: Photo) => ({
  id: photo.id,
  createdAt: photo.createdAt,
  favourite: photo.favourite,
  garments: photo.garments.map(({ type, colours, match, pieceId }) => ({ type, colours, match, pieceId })),
  url: `${origin}/gallery/${photo.id}`,
})

/** A try-on as assistants see it: where it stands, the pieces it wears, and its pages on the website. */
const shownTryOn = (origin: string) => (tryOn: TryOn) => ({
  id: tryOn.id,
  status: tryOn.status,
  photoId: tryOn.photoId,
  pieceIds: tryOn.pieceIds,
  createdAt: tryOn.createdAt,
  url: `${origin}/try-on/${tryOn.id}`,
  photoUrl: `${origin}/gallery/${tryOn.photoId}`,
})

const photoList = toolSpec({
  name: 'photo_list',
  title: 'Your Gallery photos',
  description:
    'The person’s own outfit photos in My Gallery, newest first: when each came in, what Styld found in it and its page. You never see the photos: show them with gallery_show and let the person say which one.',
  parameters: Schema.Struct({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
})

const tryOnStart = toolSpec({
  name: 'tryon_start',
  title: 'Try pieces on',
  description: `Redraw one of the person’s own Gallery photos (photo_list) with them wearing 1 to ${String(maximumTryOnPieces)} of their pieces (piece_search), for ${creditsText(prices.tryOn)}, given back if it is refused or lost. Only a photo of the person themselves: ask them whether it shows them and pass \`thisIsMe: true\` only when they say yes, never for anyone else. It is drawn in the background (about half a minute): read it with tryon_get, then show it with tryon_show. Choose a new \`operationId\`.`,
  parameters: StartTryOn,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
})

const tryOnGet = toolSpec({
  name: 'tryon_get',
  title: 'How a try-on is going',
  description:
    'Where a try-on stands: admitting, drawing, done, refused or failed (the credits came back for the last two), with its page on Styld. When it is done, show it with tryon_show.',
  parameters: Schema.Struct({ tryOnId: TryOnId }),
  annotations: { readOnlyHint: true, openWorldHint: false },
})

const tryOnList = toolSpec({
  name: 'tryon_list',
  title: 'Your try-ons',
  description: 'The person’s try-ons, newest first, each with the photo and pieces it used and its page on Styld.',
  parameters: Schema.Struct({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
})

/** Try on: the person's Gallery photos, and their own photo drawn again wearing their pieces. */
export const tryOnTools = (
  tryOns: Pick<TryOns['Service'], 'start' | 'get' | 'list' | 'delete' | 'toBoard'>,
  photos: Pick<Photos['Service'], 'listPhotos'>,
  origin: string,
) => {
  const photo = shownPhoto(origin)
  const shown = shownTryOn(origin)
  return [
    tool({
      ...photoList,
      handler: () => photos.listPhotos().pipe(Effect.map((found) => ({ photos: found.map(photo) }))),
    }),
    tool({ ...tryOnStart, handler: (input) => tryOns.start(input).pipe(Effect.map(shown)) }),
    tool({ ...tryOnGet, handler: ({ tryOnId }) => tryOns.get(tryOnId).pipe(Effect.map(shown)) }),
    tool({
      ...tryOnList,
      handler: () => tryOns.list().pipe(Effect.map(({ tryOns: found }) => ({ tryOns: found.map(shown) }))),
    }),
    tool({
      name: 'tryon_delete',
      title: 'Delete a try-on',
      description:
        'Delete a try-on and its picture; the photo stays in the Gallery. One deleted before it was drawn gets its credits back. Ask the person first. Choose a new `operationId`.',
      parameters: Schema.Struct({ tryOnId: TryOnId, ...Operation.fields }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      handler: ({ tryOnId, operationId }) =>
        tryOns.delete(tryOnId, operationId).pipe(Effect.as({ deleted: true, tryOnId })),
    }),
    tool({
      name: 'tryon_pin',
      title: 'Put a try-on on a board',
      description:
        'Put a drawn try-on on one of the person’s boards (board_list) as a picture marked Generated; others see it only if the board is public. Only when the person asks. Choose a new `operationId`.',
      parameters: Schema.Struct({ tryOnId: TryOnId, ...AddTryOnToBoard.fields }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: ({ tryOnId, ...input }) =>
        tryOns.toBoard(tryOnId, input).pipe(Effect.as({ pinned: true, tryOnId, boardId: input.boardId })),
    }),
  ]
}
