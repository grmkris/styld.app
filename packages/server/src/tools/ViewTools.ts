import {
  type Board,
  BoardId,
  BoardView,
  type BoardViewLabels,
  type Pin,
  type ViewLabels,
  type ViewPin,
  WardrobeView,
} from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { groupOf, PieceFilter } from '@styld/protocol'
import { Array, Effect, Match, Schema } from 'effect'
import { withViewThumbnails } from '../kernel/SignedMedia.ts'
import type { Boards } from '../boards/Boards.ts'
import type { ImageBindings } from '../wardrobe/Delivery.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { groupsIn, mediaViewTools, type MediaServices } from './MediaViewTools.ts'
import { showsView } from './Resources.ts'
import { thumbnails } from './Thumbnails.ts'
import { tool, ViewResult } from './Tools.ts'
import { SearchCursor, searchPage } from './WardrobeTools.ts'

/** A page of the wardrobe in the host: small enough that every piece shows its picture (owner, 4 November 2026). */
const wardrobePage = 12
const wardrobePageMost = 24

/** The view's words in one language, from the reviewed catalogs. */
const labelsIn = (locale: Locale): ViewLabels => ({
  wardrobeTitle: format(locale, 'wardrobe.title', {}),
  empty: format(locale, 'wardrobe.closetEmptyTitle', {}),
  openInStyld: format(locale, 'assistantView.openInStyld', {}),
  groups: groupsIn(locale),
})

/** A board's view words in one language, from the reviewed catalogs. */
const boardLabelsIn = (locale: Locale): BoardViewLabels => ({
  pinned: format(locale, 'board.pinsTitle', {}),
  empty: format(locale, 'studio.emptyGridTitle', {}),
  picture: format(locale, 'board.picture', {}),
  openInStyld: format(locale, 'assistantView.openInStyld', {}),
})

/** What a pin shows in the view: the key of its picture (a look shows its first piece) and where it opens. */
const viewPin =
  (origin: string) =>
  (pin: Pin): ViewPin =>
    Match.value(pin).pipe(
      Match.tagsExhaustive({
        PiecePin: ({ id, piece }) => ({
          id,
          name: piece.name,
          image: `piece:${piece.id}`,
          url: `${origin}/wardrobe/${piece.id}`,
        }),
        PicturePin: ({ id, imageId }) => ({ id, name: null, image: `picture:${imageId}`, url: null }),
        LookPin: ({ id, look }) => ({
          id,
          name: look.name,
          image: `piece:${look.pieces[0]?.id ?? ''}`,
          url: `${origin}/looks/${look.id}`,
        }),
      }),
    )

/** The board's thumbnails, the collage's first, each picture once. */
const ofPiece = (pieceId: string): readonly [string, string] => [`piece:${pieceId}`, pieceId] as const
const ofPicture = (imageId: string): readonly [string, string] => [`picture:${imageId}`, imageId] as const
const boardTargets = (board: Board) => {
  const onTable = board.items
    .toSorted((a, b) => a.z - b.z)
    .flatMap((item) =>
      Match.value(item).pipe(
        Match.tagsExhaustive({
          PieceItem: ({ pieceId }) => [ofPiece(pieceId)],
          ImageItem: ({ imageId }) => [ofPicture(imageId)],
          TextItem: () => [],
        }),
      ),
    )
  const pinned = board.pins.flatMap((pin) =>
    Match.value(pin).pipe(
      Match.tagsExhaustive({
        PiecePin: ({ piece }) => [ofPiece(piece.id)],
        PicturePin: ({ imageId }) => [ofPicture(imageId)],
        LookPin: ({ look }) => look.pieces.slice(0, 1).map((piece) => ofPiece(piece.id)),
      }),
    ),
  )
  return Array.dedupeWith([...onTable, ...pinned], ([left], [right]) => left === right)
}

/** Tools whose results a host draws with Styld's view (MCP Apps): the wardrobe and a board, then the person's media
 * (`MediaViewTools.ts`). */
export const viewTools = (
  wardrobe: Wardrobe['Service'],
  boards: Boards['Service'],
  origin: string,
  media: ImageBindings,
  { tryOns, photos }: Pick<MediaServices, 'tryOns' | 'photos'>,
) => [
  tool({
    name: 'wardrobe_show',
    title: 'Show your wardrobe',
    description:
      'Shows a page of the person’s pieces as pictures, newest first: 12 unless `limit` says (at most 24), filtered like piece_search (words, garment type, group, colour, season, occasion, pattern, brand). `total` counts the matches; pass `nextCursor` as `cursor` to show the next page when the person asks for more.',
    parameters: Schema.Struct({
      ...PieceFilter.fields,
      limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: wardrobePageMost }))),
      cursor: Schema.optionalKey(SearchCursor),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: (input) =>
      Effect.gen(function* () {
        const { value: found, images } = yield* withViewThumbnails(searchPage(wardrobe, input, wardrobePage))
        const { pieces, total, nextCursor } = found
        const view = WardrobeView.make({
          pieces: pieces.map((piece) => ({
            id: piece.id,
            name: piece.name,
            group: groupOf(piece.type),
            url: `${origin}/wardrobe/${piece.id}`,
          })),
          url: `${origin}/wardrobe`,
          labels: { en: labelsIn('en'), sl: labelsIn('sl') },
        })
        return new ViewResult(
          { ...view, total, nextCursor },
          {
            'styld/images': yield* thumbnails(
              media,
              images,
              pieces.map(({ id }) => [id, id] as const),
            ),
          },
        )
      }),
  }),
  tool({
    name: 'board_show',
    title: 'Show a board',
    description:
      'Shows a board as the person sees it: its collage, then what is pinned on it. Use board_get for its ids and placements.',
    parameters: Schema.Struct({ boardId: BoardId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: ({ boardId }) =>
      Effect.gen(function* () {
        const { value: board, images } = yield* withViewThumbnails(boards.getBoard(boardId))
        const pins = board.pins.map(viewPin(origin))
        const view = BoardView.make({
          name: board.name,
          paper: board.paper,
          items: board.items,
          pins,
          url: `${origin}/boards/${board.id}`,
          labels: { en: boardLabelsIn('en'), sl: boardLabelsIn('sl') },
        })
        return new ViewResult(view, { 'styld/images': yield* thumbnails(media, images, boardTargets(board)) })
      }),
  }),
  ...mediaViewTools({ origin, media, wardrobe, tryOns, photos }),
]
