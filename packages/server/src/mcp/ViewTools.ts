import { type ViewLabels, WardrobeView } from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Effect, Schema } from 'effect'
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
        return new ViewResult(view, {})
      }),
  }),
]
