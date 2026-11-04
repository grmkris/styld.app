import {
  GalleryView,
  type GalleryViewLabels,
  groupOf,
  NotFound,
  type Photo,
  type Piece,
  PieceId,
  type PiecePictureKind,
  PiecesView,
  type PiecesViewLabels,
  PieceView,
  type PieceViewLabels,
  type TryOn,
  TryOnId,
  TryOnView,
  type TryOnViewLabels,
  type ViewPiece,
} from '@styld/protocol'
import { format, type Locale } from '@styld/i18n'
import { Array, Effect, Option, Schema } from 'effect'
import { tryOnWords } from '../generation/TryOnPrompt.ts'
import type { TryOns } from '../generation/TryOn.ts'
import { type MediaGrant, withViewThumbnails } from '../kernel/SignedMedia.ts'
import type { Photos } from '../photos/Photos.ts'
import type { ImageBindings } from '../wardrobe/Delivery.ts'
import { pictureOfVersion } from '../wardrobe/Images.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { showsView } from './Resources.ts'
import { thumbnails, thumbnailsOf } from './Thumbnails.ts'
import { tool, ViewResult } from './Tools.ts'

// The person's media inside ChatGPT and Claude (owner, 4 November 2026): a try-on beside the photo it started from,
// their Gallery to choose a photo from, any of their pieces or the outfits Styld made, and one piece with all its
// pictures. Each reads through the same services the website does, and shows only what that read authorized.

/** The garment groups' names, for a piece the person did not name. */
const groupsIn = (locale: Locale) => ({
  clothing: format(locale, 'wardrobe.groups.clothing', {}),
  sport: format(locale, 'wardrobe.groups.sport', {}),
  shoes: format(locale, 'wardrobe.groups.shoes', {}),
  accessories: format(locale, 'wardrobe.groups.accessories', {}),
})

const openIn = (locale: Locale) => format(locale, 'assistantView.openInStyld', {})

const tryOnLabelsIn = (locale: Locale): TryOnViewLabels => ({
  title: format(locale, 'assistantView.tryOn.title', {}),
  before: format(locale, 'assistantView.tryOn.before', {}),
  after: format(locale, 'assistantView.tryOn.after', {}),
  drawing: format(locale, 'assistantView.tryOn.drawing', {}),
  stopped: format(locale, 'assistantView.tryOn.stopped', {}),
  wearing: format(locale, 'assistantView.tryOn.wearing', {}),
  openInStyld: openIn(locale),
  groups: groupsIn(locale),
})

const galleryLabelsIn = (locale: Locale): GalleryViewLabels => ({
  title: format(locale, 'assistantView.gallery.title', {}),
  empty: format(locale, 'assistantView.gallery.empty', {}),
  openInStyld: openIn(locale),
})

const piecesLabelsIn = (locale: Locale): PiecesViewLabels => ({
  title: format(locale, 'assistantView.pieces.title', {}),
  outfit: format(locale, 'assistantView.pieces.outfit', {}),
  empty: format(locale, 'assistantView.pieces.empty', {}),
  openInStyld: openIn(locale),
  groups: groupsIn(locale),
})

const pieceLabelsIn = (locale: Locale): PieceViewLabels => ({
  pictures: {
    shown: format(locale, 'wardrobe.picture.main', {}),
    clean: format(locale, 'wardrobe.picture.clean', {}),
    back: format(locale, 'wardrobe.picture.backPhoto', {}),
    backClean: format(locale, 'assistantView.piece.backClean', {}),
    photo: format(locale, 'wardrobe.picture.photo', {}),
    cutout: format(locale, 'wardrobe.picture.cutout', {}),
  },
  openInStyld: openIn(locale),
  groups: groupsIn(locale),
})

const viewPiece =
  (origin: string) =>
  (piece: Piece): ViewPiece => ({
    id: piece.id,
    name: piece.name,
    group: groupOf(piece.type),
    url: `${origin}/wardrobe/${piece.id}`,
  })

/** The person's pieces among `ids`, in that order, each once; unknown ids are left out. */
const piecesAmong = (pieces: ReadonlyArray<Piece>, ids: ReadonlyArray<PieceId>) => {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  return Array.dedupe(ids).flatMap((id) => Option.toArray(Option.fromNullishOr(byId.get(id))))
}

/** How a try-on reads in its view: still drawing, drawn, or stopped (refused or lost, its credits given back). */
const statusOf = (tryOn: TryOn) =>
  tryOn.status === 'done' ? 'done' : tryOn.status === 'refused' || tryOn.status === 'failed' ? 'stopped' : 'drawing'

/** What Styld found in a Gallery photo, in a few words for the assistant. */
const foundIn = (photo: Photo) =>
  photo.garments.flatMap(({ type, colours }) => (type === null ? [] : [tryOnWords({ type, colours })]))

/** A piece's pictures that its page signed, each once and named (`wardrobe/Images.ts`): the one it shows first. */
const piecePictures = (grants: ReadonlyArray<MediaGrant>) =>
  Array.dedupeWith(
    grants.flatMap((grant) =>
      Option.toArray(Option.map(pictureOfVersion(grant.version), (kind) => [kind, grant] as const)),
    ),
    ([left], [right]) => left === right,
  )

const tryOnShow = (services: MediaServices) =>
  tool({
    name: 'tryon_show',
    title: 'Show a try-on',
    description:
      'Shows a try-on as the person sees it: their photo and the picture Styld drew of them in the chosen pieces, side by side, and the pieces it wears. While it is still being drawn it says so: show it again once tryon_get reads done.',
    parameters: Schema.Struct({ tryOnId: TryOnId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: ({ tryOnId }) =>
      Effect.gen(function* () {
        const { value, images } = yield* withViewThumbnails(
          Effect.gen(function* () {
            const tryOn = yield* services.tryOns.get(tryOnId)
            yield* services.photos
              .getPhoto(tryOn.photoId)
              .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined)))
            return { tryOn, pieces: piecesAmong(yield* services.wardrobe.listPieces(), tryOn.pieceIds) }
          }),
        )
        const { tryOn, pieces } = value
        const view = TryOnView.make({
          id: tryOn.id,
          status: statusOf(tryOn),
          before: `photo:${tryOn.photoId}`,
          after: `tryOn:${tryOn.id}`,
          pieces: pieces.map(viewPiece(services.origin)),
          url: `${services.origin}/try-on/${tryOn.id}`,
          labels: { en: tryOnLabelsIn('en'), sl: tryOnLabelsIn('sl') },
        })
        const targets = [
          [view.before, tryOn.photoId] as const,
          [view.after, tryOn.id] as const,
          ...pieces.map(({ id }) => [id, id] as const),
        ]
        return new ViewResult(view, { 'styld/images': yield* thumbnails(services.media, images, targets, 11) })
      }),
  })

/** The most Gallery photos a view shows: enough to choose from, few enough to stay small. */
const galleryLimit = 12

const galleryShow = (services: MediaServices) =>
  tool({
    name: 'gallery_show',
    title: 'Show your Gallery',
    description: `Shows the person's newest ${String(galleryLimit)} My Gallery photos, numbered and dated, so they can say which one shows them for a try-on. You never see the photos: use each photo's number, day and what Styld found in it to know which one they mean.`,
    parameters: Schema.Struct({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: () =>
      Effect.gen(function* () {
        const { value: photos, images } = yield* withViewThumbnails(services.photos.listPhotos())
        const shown = photos.slice(0, galleryLimit)
        const view = GalleryView.make({
          photos: shown.map((photo, at) => ({
            id: photo.id,
            number: at + 1,
            day: photo.createdAt.slice(0, 10),
            found: foundIn(photo),
            url: `${services.origin}/gallery/${photo.id}`,
          })),
          url: `${services.origin}/gallery`,
          labels: { en: galleryLabelsIn('en'), sl: galleryLabelsIn('sl') },
        })
        const targets = shown.map(({ id }) => [`photo:${id}`, id] as const)
        return new ViewResult(view, {
          'styld/images': yield* thumbnails(services.media, images, targets, galleryLimit),
        })
      }),
  })

/** Rows of the person's pieces as one view: pictures for the first 24 pieces across the rows. */
const piecesView = (
  services: MediaServices,
  rows: ReadonlyArray<ReadonlyArray<PieceId>>,
  outfits: boolean,
  title: string | undefined,
) =>
  Effect.gen(function* () {
    const { value: pieces, images } = yield* withViewThumbnails(services.wardrobe.listPieces())
    const found = rows.map((row) => piecesAmong(pieces, row)).filter((row) => row.length > 0)
    if (found.length === 0) return yield* NotFound.make({})
    const view = PiecesView.make({
      title: title ?? null,
      outfits,
      rows: found.map((row) => row.map(viewPiece(services.origin))),
      url: `${services.origin}/wardrobe`,
      labels: { en: piecesLabelsIn('en'), sl: piecesLabelsIn('sl') },
    })
    const targets = Array.dedupe(found.flat().map(({ id }) => id)).map((id) => [id, id] as const)
    return new ViewResult(view, { 'styld/images': yield* thumbnails(services.media, images, targets) })
  })

const PieceIds = Schema.Array(PieceId).check(Schema.isMinLength(1), Schema.isMaxLength(24))

const piecesShow = (services: MediaServices) =>
  tool({
    name: 'pieces_show',
    title: 'Show some pieces',
    description:
      'Shows some of the person’s own pieces as pictures: a look’s pieces (look_get), search results (piece_search), a piece just added or redrawn. Up to 24 piece ids, in the order to show them, and an optional short title.',
    parameters: Schema.Struct({
      pieceIds: PieceIds,
      title: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: ({ pieceIds, title }) => piecesView(services, [pieceIds], false, title),
  })

const outfitsShow = (services: MediaServices) =>
  tool({
    name: 'outfits_show',
    title: 'Show outfits',
    description:
      'Shows outfits of the person’s own pieces as rows of pictures, one row per outfit: pass the outfits outfit_make proposed (their piece ids, in wearing order), up to 6, and an optional short title.',
    parameters: Schema.Struct({
      outfits: Schema.Array(Schema.Struct({ pieceIds: PieceIds })).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
      title: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: ({ outfits, title }) =>
      piecesView(
        services,
        outfits.map(({ pieceIds }) => pieceIds),
        true,
        title,
      ),
  })

const pieceShow = (services: MediaServices) =>
  tool({
    name: 'piece_show',
    title: 'Show a piece',
    description:
      'Shows one of the person’s pieces with all its pictures: the one it shows, its shop-style picture, its back, the person’s own photo and the cut-out, whichever it has.',
    parameters: Schema.Struct({ pieceId: PieceId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: showsView,
    handler: ({ pieceId }) =>
      Effect.gen(function* () {
        const { value: piece, every } = yield* withViewThumbnails(services.wardrobe.getPiece(pieceId))
        const pictures = piecePictures(every.get(piece.id) ?? [])
        const imageOf = (kind: PiecePictureKind) => `piece:${piece.id}:${kind}`
        const view = PieceView.make({
          piece: viewPiece(services.origin)(piece),
          details: [tryOnWords(piece), ...Option.toArray(Option.fromNullishOr(piece.brand))],
          pictures: pictures.map(([kind]) => ({ kind, image: imageOf(kind) })),
          labels: { en: pieceLabelsIn('en'), sl: pieceLabelsIn('sl') },
        })
        const targets = pictures.map(([kind, grant]) => [imageOf(kind), grant] as const)
        return new ViewResult(view, { 'styld/images': yield* thumbnailsOf(services.media, targets) })
      }),
  })

/** What the media views read through: the same services the website's pages use. */
export interface MediaServices {
  readonly origin: string
  readonly media: ImageBindings
  readonly wardrobe: Pick<Wardrobe['Service'], 'listPieces' | 'getPiece'>
  readonly tryOns: Pick<TryOns['Service'], 'get'>
  readonly photos: Pick<Photos['Service'], 'listPhotos' | 'getPhoto'>
}

/** Tools whose results a host draws with Styld's view: a try-on, the Gallery, pieces, outfits and one piece. */
export const mediaViewTools = (services: MediaServices) => [
  tryOnShow(services),
  galleryShow(services),
  piecesShow(services),
  outfitsShow(services),
  pieceShow(services),
]
