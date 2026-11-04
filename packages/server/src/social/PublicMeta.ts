import { format, type Locale } from '@styld/i18n'
import { type PageMeta, NotFound, type PublicPiece, type PublicPin } from '@styld/protocol'
import { Effect, Match, type Option } from 'effect'
import type { PublicPages } from './Public.ts'

// What a link preview shows of a public page: its title, a line about it and a picture, read through the same rules
// as the page itself, so a private or held-back page has no preview either.

const pieceImage = (piece: PublicPiece) => `/cdn/public/pieces/${piece.id}/full`

const pinImage = (pin: PublicPin): ReadonlyArray<string> =>
  Match.value(pin).pipe(
    Match.tagsExhaustive({
      PublicPiecePin: ({ piece }) => [pieceImage(piece)],
      PublicPicturePin: ({ imageId }) => [`/cdn/public/pictures/${imageId}/full`],
      PublicLookPin: ({ look }) => look.pieces.slice(0, 1).map(pieceImage),
    }),
  )

const firstOf = (images: ReadonlyArray<string>) => images[0] ?? null

/** A link preview of a house board, look or piece whose garments Styld generated says so (owner, 4 November 2026). */
const generatedNote = (generated: boolean, description: string, locale: Locale) =>
  generated ? `${format(locale, 'board.generatedHint', {})}. ${description}` : description

const profilePath = /^\/@([a-z0-9._]{3,30})$/u
const pagePath = /^\/(boards|looks|pieces)\/([A-Za-z0-9_-]{1,40})$/u

/** The preview of the page at `path`, in `locale`, as `viewer` (signed in, or none) would see the page: anything
 * else, anything not public, and anything a block stands between, is not found. */
export const pageMeta = (pages: PublicPages['Service'], path: string, locale: Locale, viewer: Option.Option<string>) =>
  Effect.gen(function* () {
    const handle = profilePath.exec(path)?.[1]
    if (handle !== undefined) {
      const profile = yield* pages.profile(handle, viewer)
      return {
        title: format(locale, 'profile.public.metaTitle', { name: profile.name, username: profile.handle }),
        description: format(locale, 'profile.public.metaDescription', { username: profile.handle }),
        image: firstOf(profile.boards.flatMap(({ cover }) => cover.flatMap(pinImage))),
      } satisfies PageMeta
    }
    const [, kind, id = ''] = pagePath.exec(path) ?? []
    if (kind === 'boards') {
      const board = yield* pages.board(id, viewer)
      return {
        title: format(locale, 'share.board.metaTitle', { title: board.name }),
        description: generatedNote(board.generated, format(locale, 'share.board.metaDescription', {}), locale),
        image: firstOf(board.pins.flatMap(pinImage)),
      } satisfies PageMeta
    }
    if (kind === 'looks') {
      const { look } = yield* pages.look(id, viewer)
      return {
        title: format(locale, 'share.board.metaTitle', { title: look.name }),
        description: generatedNote(look.generated, format(locale, 'share.look.metaDescription', {}), locale),
        image: firstOf(look.pieces.map(pieceImage)),
      } satisfies PageMeta
    }
    if (kind === 'pieces') {
      const { piece } = yield* pages.piece(id, viewer)
      return {
        title: format(locale, 'share.board.metaTitle', {
          title: piece.name ?? format(locale, `wardrobe.typeOne.${piece.type}`, {}),
        }),
        description: generatedNote(piece.generated, format(locale, 'share.piece.metaDescription', {}), locale),
        image: pieceImage(piece),
      } satisfies PageMeta
    }
    return yield* NotFound.make({})
  })
