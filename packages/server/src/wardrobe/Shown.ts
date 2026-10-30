import type { PictureChoice, PiecePicture } from '@styld/protocol'
import type { PictureRow, PieceRow } from './Store.ts'

// A claim older than Muse's 90 s timeout plus the keying belongs to a delivery that died: its drawing may have been
// made and billed, so it is never drawn again on its own, and the piece shows its photo.
const patienceMillis = 3 * 60 * 1000

/** Whether a claimed drawing has outlived any delivery that could still finish it. */
export const isStale = (picture: Pick<PictureRow, 'state' | 'claimedAt'>, at: Date) =>
  picture.state === 'generating' &&
  (picture.claimedAt === null || at.getTime() - picture.claimedAt.getTime() > patienceMillis)

/** Which picture a piece shows: a ready drawing unless its owner chose the photo, a proposed one only once they chose
 * it, and the photo otherwise. */
export const shows = (picture: PictureRow | undefined): PictureChoice => {
  if (picture === undefined || picture.cleanKey === null) return 'photo'
  if (picture.state === 'ready') return picture.shown ?? 'clean'
  return picture.state === 'proposed' && picture.shown === 'clean' ? 'clean' : 'photo'
}

/** The stored image a piece shows, wherever a piece's picture appears: its clean drawing (`shows`), else its cut-out,
 * else the photo it came from. */
export const shownImage = (
  piece: Pick<PieceRow, 'imageKey' | 'originalKey' | 'contentType'>,
  picture: PictureRow | undefined,
): { readonly key: string; readonly contentType: string } => {
  const cleanKey = picture?.cleanKey ?? null
  return cleanKey !== null && shows(picture) === 'clean'
    ? { key: cleanKey, contentType: 'image/png' }
    : { key: piece.imageKey ?? piece.originalKey, contentType: piece.contentType }
}

const states: Record<PictureRow['state'], PiecePicture['state']> = {
  queued: 'drawing',
  generating: 'drawing',
  checking: 'drawing',
  ready: 'ready',
  proposed: 'proposed',
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
