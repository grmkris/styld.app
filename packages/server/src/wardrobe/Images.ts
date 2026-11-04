import type { PieceImages, PieceTurn } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { SignedMedia } from '../kernel/SignedMedia.ts'
import type { ImageSize } from './Media.ts'
import { isDrawn, shownImage, shows, turnView } from './Shown.ts'
import { piecePrefix } from './Media.ts'
import type { PictureRow, PieceRow, TurnRow } from './Store.ts'

// A piece's pictures, as stored objects and as the signed addresses the owner's browser loads them by
// (`kernel/SignedMedia.ts`): the one it shows, its clean drawing and its back; and on its own page its plain cut-out
// and the photo it came from.

/** One of a piece's pictures: the one it shows, its clean drawing, its back, its plain cut-out (when it was cut out),
 * and the person's own photo it came from. */
type PieceView = 'shown' | 'clean' | 'back' | 'cutout' | 'original'

/** The stored image behind one of a piece's pictures, if it has that picture, and the quarter turn it is delivered
 * with: the owner's rotation turns their own photo and cut-out (`shownImage`), never the drawing, which is drawn
 * upright, or the back, a photo of its own. The stored object's own type is what is served (`deliverImage`). */
const pictureImage = (piece: PieceRow, picture: PictureRow | undefined, which: PieceView) => {
  const { contentType, rotation } = piece
  if (which === 'shown') return Option.some(shownImage(piece, picture))
  if (which === 'original') return Option.some({ key: piece.originalKey, contentType, rotation })
  if (which === 'cutout')
    return piece.imageKey === null || piece.imageKey === piece.originalKey
      ? Option.none()
      : Option.some({ key: piece.imageKey, contentType, rotation })
  if (which === 'back')
    return Option.map(Option.fromNullishOr(piece.backImageKey), (key) => ({ key, contentType, rotation: 0 as const }))
  return isDrawn(picture)
    ? Option.some({ key: picture.cleanKey, contentType: 'image/png', rotation: 0 as const })
    : Option.none()
}

/** The version a piece's picture is shown under: a change to the piece, a new drawing, or a change of which picture
 * shows is a new version, and so a new address. */
const pictureVersion = (piece: PieceRow, picture: PictureRow | undefined, which: PieceView) => {
  const drawing =
    which === 'original' || which === 'cutout' || which === 'back'
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
      onSome: ({ key, contentType, rotation }) =>
        signed.address({
          entityId: piece.id,
          key,
          contentType,
          variant: size,
          version: pictureVersion(piece, picture, which),
          rotation,
        }),
    }),
  )

/** The addresses the owner's browser loads a piece's pictures by: none for an assistant. Its own page (`page`) also
 * gets its plain cut-out and the photo it came from; a list of pieces does not sign what it never shows. */
export const pieceImages = Effect.fnUntraced(function* (
  piece: PieceRow,
  picture: PictureRow | undefined,
  page = false,
) {
  const shown = Option.all({
    thumb: yield* addressOf(piece, picture, 'shown', 'thumb'),
    full: yield* addressOf(piece, picture, 'shown', 'full'),
  })
  if (Option.isNone(shown)) return Option.none<PieceImages>()
  const extra: Partial<Record<'clean' | 'back' | 'photo' | 'cutout', string>> = {}
  const views = page
    ? ([
        ['clean', 'clean'],
        ['back', 'back'],
        ['photo', 'original'],
        ['cutout', 'cutout'],
      ] as const)
    : ([
        ['clean', 'clean'],
        ['back', 'back'],
      ] as const)
  for (const [name, which] of views) {
    const address = yield* addressOf(piece, picture, which, 'full')
    if (Option.isSome(address)) extra[name] = address.value
  }
  return Option.some<PieceImages>({ ...shown.value, ...extra })
})

/** The turn's generated files keep their exact dimensions; their grants are separate from resized photos. */
export const shownTurn = Effect.fnUntraced(function* (turn: TurnRow, at: Date) {
  const view = turnView(turn, at)
  if (view.state !== 'building' && view.state !== 'ready') return view
  const signed = yield* SignedMedia
  const media: { video?: string; front?: string; sheet?: string } = {}
  for (const part of ['video', 'front', 'sheet'] as const) {
    if (part === 'sheet' && view.state !== 'ready') continue
    const file = part === 'video' ? 'turn.mp4' : `${part}.png`
    const address = yield* signed.address({
      entityId: turn.pieceId,
      key: `${piecePrefix(turn.accountId, turn.pieceId)}turn-${file}`,
      contentType: part === 'video' ? 'video/mp4' : 'image/png',
      variant: `turn-${part}`,
      version: `${turn.attempt}.${turn.updatedAt.getTime()}`,
    })
    if (Option.isSome(address)) media[part] = address.value
  }
  return { ...view, ...(Object.keys(media).length === 0 ? {} : { media }) } satisfies PieceTurn
})
