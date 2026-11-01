import type { Piece } from '@styld/protocol'

// Where the edge serves stored pictures and videos (`/cdn/…`), one builder per kind, so the pages name what they show
// rather than spelling paths. A version in the query asks for a new copy once the picture changes.

type Size = 'thumb' | 'full'

/** The version a piece's picture is cached under: which picture it shows and how often it was drawn. */
const pictureVersion = (piece: Piece) =>
  piece.picture === undefined ? '' : `?v=${piece.picture.shows}${piece.picture.version}`

export const cdn = {
  /** A piece of the person's, as its picture shows it now (versioned when the piece is at hand). */
  piece: (pieceId: string, size: Size = 'thumb') => `/cdn/pieces/${pieceId}/${size}`,
  pieceShown: (piece: Piece, size: Size) => `/cdn/pieces/${piece.id}/${size}${pictureVersion(piece)}`,
  pieceBack: (piece: Piece) => `/cdn/pieces/${piece.id}/back/full?v=${Date.parse(piece.updatedAt)}`,
  pieceClean: (pieceId: string, version: number) => `/cdn/pieces/${pieceId}/clean/thumb?v=${version}`,
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
