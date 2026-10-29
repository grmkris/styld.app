import { type ViewLabels, WardrobeView } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { type Piece, type ViewImages } from '@styld/protocol'
import { Effect, Option, Record, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { collect } from '../Streams.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { showsView } from './Resources.ts'
import { tool, ToolError, ViewResult } from './Tools.ts'

/** The view's words in one language, from the reviewed catalogs. */
const labelsIn = (locale: Locale): ViewLabels => ({
  wardrobeTitle: format(locale, 'wardrobe.title', {}),
  empty: format(locale, 'wardrobe.closetEmptyTitle', {}),
  openInStyld: format(locale, 'assistantView.openInStyld', {}),
  categories: {
    top: format(locale, 'wardrobe.mainCategories.top', {}),
    bottom: format(locale, 'wardrobe.mainCategories.bottom', {}),
    dress: format(locale, 'wardrobe.mainCategories.dress', {}),
    outerwear: format(locale, 'wardrobe.mainCategories.outerwear', {}),
    shoes: format(locale, 'wardrobe.mainCategories.shoes', {}),
    accessory: format(locale, 'wardrobe.mainCategories.accessory', {}),
  },
})

const unavailable = () =>
  new ToolError({
    code: 'unavailable',
    message: 'Styld could not read your wardrobe just now.',
    recovery: 'Try again in a moment.',
    retryable: true,
  })

/** The view shows this many pieces with pictures; their thumbnails ride in the result's `_meta`, out of
 * the model's context, because a host's sandbox cannot load Styld's private image routes. */
const viewImageLimit = 24

/** A piece's thumbnail as a data URL, or nothing when it cannot be read. */
const thumbnailOf = (wardrobe: Wardrobe['Service'], piece: Piece) =>
  wardrobe.pieceImage(piece.id, 'thumb').pipe(
    Effect.flatMap(({ body, contentType }) =>
      Effect.tryPromise({ try: () => collect(body), catch: () => 'unreadable' as const }).pipe(
        Effect.map((bytes) => `data:${contentType};base64,${Base64.encode(bytes)}`),
      ),
    ),
    Effect.option,
    Effect.map((url) => Option.map(url, (data) => [piece.id, data] as const)),
  )

/** Thumbnails of the first pieces the view shows, read a few at a time. */
const thumbnails = (wardrobe: Wardrobe['Service'], pieces: ReadonlyArray<Piece>) =>
  Effect.map(
    Effect.forEach(pieces.slice(0, viewImageLimit), (piece) => thumbnailOf(wardrobe, piece), { concurrency: 6 }),
    (found): ViewImages => Record.fromEntries(found.flatMap(Option.toArray)),
  )

/** Tools whose results a host draws with Styld's view (MCP Apps). */
export const viewTools = (wardrobe: Wardrobe['Service'], origin: string) => [
  tool({
    name: 'wardrobe_show',
    title: 'Show your wardrobe',
    description:
      'Shows the pieces in your Styld wardrobe as pictures the person can browse. Use piece_search to find pieces by words, category or colour.',
    parameters: Schema.Struct({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: () =>
      Effect.gen(function* () {
        const pieces = yield* wardrobe.listPieces().pipe(Effect.mapError(unavailable))
        const view = WardrobeView.make({
          pieces: pieces.map((piece) => ({
            id: piece.id,
            name: piece.name,
            category: piece.category,
            url: `${origin}/wardrobe/${piece.id}`,
          })),
          url: `${origin}/wardrobe`,
          labels: { en: labelsIn('en'), sl: labelsIn('sl') },
        })
        return new ViewResult(view, { 'styld/images': yield* thumbnails(wardrobe, pieces) })
      }),
  }),
]
