import { Effect } from 'effect'
import type { Boards } from '../../src/boards/Boards.ts'

const notUsed = () => Effect.die('not used by these tests')

/** Every board operation, none of them used: tests spread it and replace the operations they are about. */
export const unusedBoards: Boards['Service'] = {
  listBoards: notUsed,
  getBoard: notUsed,
  createBoard: notUsed,
  updateBoard: notUsed,
  deleteBoard: notUsed,
  saveBoardItems: notUsed,
  arrangeBoard: notUsed,
  setTable: notUsed,
  addPins: notUsed,
  removePins: notUsed,
  keepLook: notUsed,
  createOutfitBoard: notUsed,
  anotherOutfit: notUsed,
  anotherLayout: notUsed,
  addBoardImage: notUsed,
  addGeneratedImage: notUsed,
  addPhotoImage: notUsed,
  setBoardVisibility: notUsed,
}
