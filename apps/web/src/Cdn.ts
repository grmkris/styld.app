import type { Piece, PieceImages, PieceTurn, Photo, PhotoGarment, Detection } from '@styld/protocol'

// Private media uses addresses supplied by the containing API response. Public media retains its visibility-checked
// routes. No browser view constructs a session-backed private image address.

type Size = 'thumb' | 'full'

/** The person's pieces' pictures by id, for what names a piece only by its id (a table's items, Styld's answers). */
export type PieceImagesById = ReadonlyMap<string, PieceImages>

export const piecesById = (pieces: ReadonlyArray<Piece>): PieceImagesById =>
  new Map(pieces.flatMap((piece) => (piece.images === undefined ? [] : [[piece.id, piece.images] as const])))

export const cdn = {
  /** A piece of the person's, as its picture shows it now; empty while its addresses are not at hand. */
  piece: (piece: Pick<Piece, 'images'> | undefined, size: Size = 'thumb') => piece?.images?.[size] ?? '',
  /** A piece known only by its id, from the pieces at hand. */
  pieceById: (pieces: PieceImagesById, pieceId: string, size: Size = 'thumb') => pieces.get(pieceId)?.[size] ?? '',
  pieceBack: (piece: Piece) => piece.images?.back ?? '',
  pieceClean: (piece: Piece) => piece.images?.clean ?? '',
  /** The API supplies private media addresses after authorizing the containing entity once. */
  turn: (turn: PieceTurn | undefined, part: 'video' | 'front' | 'sheet') => turn?.media?.[part] ?? '',
  photo: (photo: Photo, size: Size) => photo.images?.[size] ?? '',
  /** The person cut out of an outfit photo, once there is one (T-17). */
  photoCutout: (photo: Photo, size: Size) => photo.cutoutImages?.[size] ?? '',
  photoGarment: (garment: PhotoGarment) => garment.image ?? '',
  detection: (detection: Detection, cutout: boolean) => detection.images?.[cutout ? 'cutout' : 'original'] ?? '',
  boardImage: (
    picture: { readonly image?: { readonly thumb: string; readonly full: string } | undefined },
    size: Size = 'full',
  ) => picture.image?.[size] ?? '',
  /** What others see: served only while the page it is on is public. */
  publicPiece: (pieceId: string, size: Size = 'thumb') => `/cdn/public/pieces/${pieceId}/${size}`,
  publicPicture: (imageId: string, size: Size = 'full') => `/cdn/public/pictures/${imageId}/${size}`,
}
