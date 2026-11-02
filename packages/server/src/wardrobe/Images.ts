import type { PieceImages } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { SignedMedia } from '../kernel/SignedMedia.ts'
import type { ImageSize } from './Media.ts'
import { shownImage, shows } from './Shown.ts'
import type { PictureRow, PieceRow } from './Store.ts'

// A piece's pictures, as stored objects and as the signed addresses the owner's browser loads them by
// (`kernel/SignedMedia.ts`): the one it shows, its photo, its clean drawing and its back.

/** One of a piece's pictures. */
export type PieceView = 'shown' | 'photo' | 'clean' | 'back'

/** The stored image behind one of a piece's pictures, if it has that picture. */
export const pictureImage = (piece: PieceRow, picture: PictureRow | undefined, which: PieceView) => {
  if (which === 'shown') return Option.some(shownImage(piece, picture))
  if (which === 'photo') return Option.some(shownImage(piece, undefined))
  // The stored object's own type is what is served (`deliverImage`).
  if (which === 'back')
    return Option.map(Option.fromNullishOr(piece.backImageKey), (key) => ({ key, contentType: piece.contentType }))
  const drawn = picture?.cleanKey ?? null
  return drawn !== null && (picture?.state === 'ready' || picture?.state === 'proposed')
    ? Option.some({ key: drawn, contentType: 'image/png' })
    : Option.none()
}

/** The version a piece's picture is shown under: a change to the piece, a new drawing, or a change of which picture
 * shows is a new version, and so a new address. */
export const pictureVersion = (piece: PieceRow, picture: PictureRow | undefined, which: PieceView) => {
  const drawing =
    which === 'photo' || which === 'back'
      ? which
      : `${which === 'clean' ? 'clean' : shows(picture)}${picture?.version ?? 0}`
  return `${piece.updatedAt.getTime()}.${drawing}`
}

/** The signed address of one of a piece's pictures at one size, if it has that picture and the reader is the owner's
 * browser. */
const addressOf = (piece: PieceRow, picture: PictureRow | undefined, which: PieceView, size: ImageSize) =>
  Effect.flatMap(SignedMedia, (signed) =>
    Option.match(pictureImage(piece, picture, which), {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: ({ key, contentType }) =>
        signed.address({
          entityId: piece.id,
          key,
          contentType,
          variant: size,
          version: pictureVersion(piece, picture, which),
        }),
    }),
  )

/** The addresses the owner's browser loads a piece's pictures by: none for an assistant. */
export const pieceImages = Effect.fnUntraced(function* (piece: PieceRow, picture: PictureRow | undefined) {
  const shown = Option.all({
    thumb: yield* addressOf(piece, picture, 'shown', 'thumb'),
    full: yield* addressOf(piece, picture, 'shown', 'full'),
  })
  if (Option.isNone(shown)) return Option.none<PieceImages>()
  const clean = yield* addressOf(piece, picture, 'clean', 'thumb')
  const back = yield* addressOf(piece, picture, 'back', 'full')
  return Option.some<PieceImages>({
    ...shown.value,
    ...Option.match(clean, { onNone: () => ({}), onSome: (address) => ({ clean: address }) }),
    ...Option.match(back, { onNone: () => ({}), onSome: (address) => ({ back: address }) }),
  })
})
