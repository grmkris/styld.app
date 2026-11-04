import type { PictureChoice, PiecePicture, PieceRotation, PieceTurn } from '@styld/protocol'
import type { PictureRow, PieceRow, TurnRow } from './Store.ts'

// A claim older than Muse's 90 s timeout plus the keying belongs to a delivery that died: its drawing may have been
// made and billed, so it is never drawn again on its own, and the piece shows its photo.
const patienceMillis = 3 * 60 * 1000

/** Whether a claimed drawing has outlived any delivery that could still finish it. */
export const isStale = (picture: Pick<PictureRow, 'state' | 'claimedAt'>, at: Date) =>
  picture.state === 'generating' &&
  (picture.claimedAt === null || at.getTime() - picture.claimedAt.getTime() > patienceMillis)

/** Whether a picture holds a drawing that passed its check: ready, or proposed (a drawing between the reject bar and
 * 0.8, which waited for its owner's tap until 4 November and is shown like any other that passed, `Policy.ts`). */
export const isDrawn = <P extends Pick<PictureRow, 'state' | 'cleanKey'>>(
  picture: P | undefined,
): picture is P & { readonly cleanKey: string } =>
  picture !== undefined && picture.cleanKey !== null && (picture.state === 'ready' || picture.state === 'proposed')

/** Which picture a piece shows: a drawing that passed its check unless its owner chose the photo, and the photo
 * otherwise. */
export const shows = (picture: PictureRow | undefined): PictureChoice =>
  isDrawn(picture) ? (picture.shown ?? 'clean') : 'photo'

/** The stored image a piece shows, wherever a piece's picture appears: its clean drawing (`shows`), else its cut-out,
 * else the photo it came from; with the quarter turn it is delivered with. The owner's rotation turns their own photo
 * and cut-out, never a drawing: Muse draws the garment upright from the turned cut-out (`capture/Pictures.ts`). */
export const shownImage = (
  piece: Pick<PieceRow, 'imageKey' | 'originalKey' | 'contentType' | 'rotation'>,
  picture: PictureRow | undefined,
): { readonly key: string; readonly contentType: string; readonly rotation: PieceRotation } => {
  const cleanKey = picture?.cleanKey ?? null
  return cleanKey !== null && shows(picture) === 'clean'
    ? { key: cleanKey, contentType: 'image/png', rotation: 0 }
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

/** A piece's clean picture as its owner sees it. A drawing claimed too long ago shows as failed: the photo stays and
 * the person may ask again. */
export const pictureView = (picture: PictureRow, at: Date): PiecePicture => ({
  state: isStale(picture, at) ? 'failed' : states[picture.state],
  shows: shows(picture),
  version: picture.version,
})

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
