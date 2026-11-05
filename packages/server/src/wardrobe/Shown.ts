import type { PictureChoice, PiecePicture, PieceRotation, PieceTurn } from '@styld/protocol'
import { drawingPatienceMillis } from '../kernel/Patience.ts'
import type { PictureRow, PieceRow, TurnRow } from './Store.ts'

// A claim past the drawing patience belongs to a delivery that died: its drawing may have been made and billed, so it
// is never drawn again on its own, and the piece shows its photo.

/** Whether a claimed drawing has outlived any delivery that could still finish it. */
export const isStale = (picture: Pick<PictureRow, 'state' | 'claimedAt'>, at: Date) =>
  picture.state === 'generating' &&
  (picture.claimedAt === null || at.getTime() - picture.claimedAt.getTime() > drawingPatienceMillis)

/** Whether a picture holds a drawing to show: ready, or proposed (a drawing that waited for its owner's tap until 4
 * November and is shown like any other, `Policy.ts`). */
export const isDrawn = <P extends Pick<PictureRow, 'state' | 'cleanKey'>>(
  picture: P | undefined,
): picture is P & { readonly cleanKey: string } =>
  picture !== undefined && picture.cleanKey !== null && (picture.state === 'ready' || picture.state === 'proposed')

/** Which picture a piece shows: its drawing unless its owner chose the photo, and the photo otherwise. */
export const shows = (picture: PictureRow | undefined): PictureChoice =>
  isDrawn(picture) ? (picture.shown ?? 'clean') : 'photo'

/** The quarter turn a piece's drawing, and the turn made from it, are shown with: what the piece's rotation is past
 * the one it was drawn at. Muse draws from the cut-out turned by the piece's rotation (`capture/Drawing.ts` ›
 * `frontOf`), so a drawing made after a rotation is upright, and one made before it turns with the piece (Eva,
 * 4 November: Rotate turned the cut-out but never the shop-style picture). */
export const drawingTurn = (
  piece: Pick<PieceRow, 'rotation'>,
  picture: Pick<PictureRow, 'drawnRotation'> | undefined,
): PieceRotation => {
  const turn = (piece.rotation - (picture?.drawnRotation ?? 0) + 360) % 360
  return turn === 90 || turn === 180 || turn === 270 ? turn : 0
}

/** The stored image a piece shows, wherever a piece's picture appears: its clean drawing (`shows`), else its cut-out,
 * else the photo it came from; with the quarter turn it is delivered with. The owner's rotation turns their own photo
 * and cut-out, and the drawing by what it is past the rotation the drawing was drawn at (`drawingTurn`). */
export const shownImage = (
  piece: Pick<PieceRow, 'imageKey' | 'originalKey' | 'contentType' | 'rotation'>,
  picture: PictureRow | undefined,
): { readonly key: string; readonly contentType: string; readonly rotation: PieceRotation } => {
  const cleanKey = picture?.cleanKey ?? null
  return cleanKey !== null && shows(picture) === 'clean'
    ? { key: cleanKey, contentType: 'image/png', rotation: drawingTurn(piece, picture) }
    : { key: piece.imageKey ?? piece.originalKey, contentType: piece.contentType, rotation: piece.rotation }
}

const states: Record<PictureRow['state'], PiecePicture['state']> = {
  queued: 'drawing',
  generating: 'drawing',
  checking: 'drawing',
  ready: 'ready',
  proposed: 'ready',
  retake: 'retake',
  'kept-real': 'kept',
  rejected: 'failed',
  failed: 'failed',
}

/** A piece's clean picture as its owner sees it, with the quarter turn its drawing is served with (`drawingTurn`),
 * which the browser gives the turn made from it, served as it was made; a redraw's answer, a drawing on its way, has
 * none. A drawing claimed too long ago shows as failed: the photo stays and the person may ask again. */
export const pictureView = (picture: PictureRow, at: Date, piece?: Pick<PieceRow, 'rotation'>): PiecePicture => {
  const rotation = piece === undefined ? 0 : drawingTurn(piece, picture)
  return {
    state: isStale(picture, at) ? 'failed' : states[picture.state],
    shows: shows(picture),
    version: picture.version,
    ...(rotation === 0 ? {} : { rotation }),
  }
}

// A turn no step has moved for this long has lost its delivery; it shows as failed and may be asked for again.
const turnPatienceMillis = 20 * 60 * 1000

const turnStates: Record<TurnRow['state'], PieceTurn['state']> = {
  requested: 'making',
  anchoring: 'making',
  generating: 'making',
  'video-ready': 'building',
  ready: 'ready',
  rejected: 'failed',
  failed: 'failed',
}

/** A piece's turn as its owner sees it: the layout of its frames once it is ready. */
export const turnView = (turn: TurnRow, at: Date): PieceTurn => {
  const state = turnStates[turn.state]
  const lost = state === 'making' && at.getTime() - turn.updatedAt.getTime() > turnPatienceMillis
  return {
    state: lost ? 'failed' : state,
    version: turn.updatedAt.getTime(),
    ...(turn.state === 'ready' && turn.layout !== null ? { layout: turn.layout } : {}),
  }
}
