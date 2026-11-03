import {
  type Board,
  BoardId,
  BoardView,
  type BoardViewLabels,
  type CurrentAccount,
  type Pin,
  type ViewLabels,
  type ViewPin,
  WardrobeView,
} from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { groupOf, type ViewImages } from '@styld/protocol'
import { Array, Effect, Match, Option, Record, Schema } from 'effect'
import { withViewThumbnails, type MediaGrant } from '../kernel/SignedMedia.ts'
import type { Boards } from '../boards/Boards.ts'
import * as Base64 from 'effect/encoding/Base64'
import { collect } from '../Streams.ts'
import { deliverImage, transformedOnly, type ImageBindings } from '../wardrobe/Delivery.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { showsView } from './Resources.ts'
import { tool, ViewResult } from './Tools.ts'

/** The view's words in one language, from the reviewed catalogs. */
const labelsIn = (locale: Locale): ViewLabels => ({
  wardrobeTitle: format(locale, 'wardrobe.title', {}),
  empty: format(locale, 'wardrobe.closetEmptyTitle', {}),
  openInStyld: format(locale, 'assistantView.openInStyld', {}),
  groups: {
    clothing: format(locale, 'wardrobe.groups.clothing', {}),
    sport: format(locale, 'wardrobe.groups.sport', {}),
    shoes: format(locale, 'wardrobe.groups.shoes', {}),
    accessories: format(locale, 'wardrobe.groups.accessories', {}),
  },
})

/** The view shows this many pieces with pictures; their thumbnails ride in the result's `_meta`, out of
 * the model's context, because a host's sandbox cannot load Styld's private image routes. */
const viewImageLimit = 24

/** A thumbnail is only what the Images binding transformed (`transformedOnly`): an original photo, which may carry its
 * EXIF and GPS, never goes to a host. A transformed one larger than this is left out too. */
const largestThumbnail = 200 * 1024

type Thumbnail = { readonly body: Parameters<typeof collect>[0]; readonly contentType: string }
type ThumbnailRead = readonly [string, Effect.Effect<Thumbnail, unknown, CurrentAccount>]

/** A thumbnail as a data URL under its key, or nothing when it cannot be read or is not a small WebP. */
const thumbnailAt = (key: string, read: Effect.Effect<Thumbnail, unknown, CurrentAccount>) =>
  read.pipe(
    Effect.filterOrFail(
      ({ contentType }) => contentType === 'image/webp',
      () => 'notThumbnail' as const,
    ),
    Effect.flatMap(({ body, contentType }) =>
      Effect.tryPromise({ try: () => collect(body), catch: () => 'unreadable' as const }).pipe(
        Effect.filterOrFail(
          (bytes) => bytes.byteLength <= largestThumbnail,
          () => 'notThumbnail' as const,
        ),
        Effect.map((bytes) => `data:${contentType};base64,${Base64.encode(bytes)}`),
      ),
    ),
    Effect.option,
    Effect.map((url) => Option.map(url, (data) => [key, data] as const)),
  )

/** Read a few at a time, the first `viewImageLimit` of them. */
const readThumbnails = (reads: ReadonlyArray<ThumbnailRead>) =>
  Effect.map(
    Effect.forEach(reads.slice(0, viewImageLimit), ([key, read]) => thumbnailAt(key, read), { concurrency: 6 }),
    (found): ViewImages => Record.fromEntries(found.flatMap(Option.toArray)),
  )

/** Deliver only objects the containing list/get already authorized. No thumbnail performs another D1 lookup. */
const thumbnails = (
  media: ImageBindings,
  images: ReadonlyMap<string, MediaGrant>,
  targets: ReadonlyArray<readonly [string, string]>,
) =>
  readThumbnails(
    targets.flatMap(([name, id]): ReadonlyArray<ThumbnailRead> => {
      const image = images.get(id)
      return image === undefined
        ? []
        : [
            [
              name,
              deliverImage(media, image, 'thumb', transformedOnly).pipe(
                Effect.flatMap(Option.match({ onNone: () => Effect.fail('missing' as const), onSome: Effect.succeed })),
              ),
            ],
          ]
    }),
  )

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

/** Tools whose results a host draws with Styld's view (MCP Apps). */
export const viewTools = (
  wardrobe: Wardrobe['Service'],
  boards: Boards['Service'],
  origin: string,
  media: ImageBindings,
) => [
  tool({
    name: 'wardrobe_show',
    title: 'Show your wardrobe',
    description:
      'Shows the pieces in your Styld wardrobe as pictures the person can browse. Use piece_search to find pieces by words, garment type or colour.',
    parameters: Schema.Struct({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: () =>
      Effect.gen(function* () {
        const { value: pieces, images } = yield* withViewThumbnails(wardrobe.listPieces())
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
        return new ViewResult(view, {
          'styld/images': yield* thumbnails(
            media,
            images,
            pieces.map(({ id }) => [id, id] as const),
          ),
        })
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
]
