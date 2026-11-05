import { Effect, Option } from 'effect'
import type { Wardrobe } from '../../src/wardrobe/Wardrobe.ts'

const notUsed = () => Effect.die('not used by these tests')

/** Every wardrobe operation, none of them used, and an empty wardrobe: tests spread it and replace the operations
 * they are about. */
export const unusedWardrobe: Wardrobe['Service'] = {
  listPieces: () => Effect.succeed([]),
  searchPieces: () => Effect.succeed({ pieces: [], total: 0, nextOffset: Option.none() }),
  getPiece: notUsed,
  newUpload: notUsed,
  createUpload: notUsed,
  once: notUsed,
  receiveUpload: notUsed,
  receiveVideoUpload: notUsed,
  choosePicture: notUsed,
  addPiece: notUsed,
  updatePiece: notUsed,
  deletePiece: notUsed,
  deletePieces: notUsed,
  processPiece: notUsed,
  setBack: notUsed,
  removeBack: notUsed,
  failPiece: notUsed,
  sweepUploads: notUsed,
}
