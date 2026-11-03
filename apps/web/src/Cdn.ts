import type { Piece, PieceImages } from '@styld/protocol'

// Where the edge serves stored pictures and videos (`/cdn/…`), one builder per kind, so the pages name what they show
// rather than spelling paths. A version in the query asks for a new copy once the picture changes. A piece's pictures
// are the signed addresses the API hands over with it (`Piece.images`): they need no session, so a screen of
// thumbnails never reads the session or D1 once per picture.

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
  /** A piece's turn: its video, its first frame and its frame sheet. */
  turn: (pieceId: string, part: 'video' | 'front' | 'sheet', version: number) =>
    `/cdn/turns/${pieceId}/${part}?v=${version}`,
  photo: (photoId: string, size: Size) => `/cdn/photos/${photoId}/${size}`,
  photoGarment: (photoId: string, garmentId: string) => `/cdn/photos/${photoId}/garments/${garmentId}`,
  /** A piece found in a capture: its cut-out, or the photo it came from. */
  detection: (detectionId: string, cutout: boolean) =>
    `/cdn/detections/${detectionId}/${cutout ? 'cutout' : 'original'}`,
  boardImage: (imageId: string, size: Size = 'full') => `/cdn/boards/images/${imageId}/${size}`,
  /** What others see: served only while the page it is on is public. */
  publicPiece: (pieceId: string, size: Size = 'thumb') => `/cdn/public/pieces/${pieceId}/${size}`,
  publicPicture: (imageId: string, size: Size = 'full') => `/cdn/public/pictures/${imageId}/${size}`,
}
