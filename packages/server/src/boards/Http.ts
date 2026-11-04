import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Boards } from './Boards.ts'

/** The website's board endpoints, each the matching `Boards` operation for the session's account; changes are
 * admitted first. */
export const boardHandlers = HttpApiBuilder.group(StyldApi, 'board', (handlers) =>
  Effect.gen(function* () {
    const boards = yield* Boards
    return handlers
      .handle('listBoards', () => boards.listBoards().pipe(Effect.map((found) => ({ boards: found }))))
      .handle('createBoard', ({ payload }) => boards.createBoard(payload))
      .handle('getBoard', ({ params }) => boards.getBoard(params.boardId))
      .handle('updateBoard', ({ params, payload }) => boards.updateBoard(params.boardId, payload))
      .handle('deleteBoard', ({ params, payload }) => boards.deleteBoard(params.boardId, payload.operationId))
      .handle('saveBoardItems', ({ params, payload }) => boards.saveBoardItems(params.boardId, payload))
      .handle('addPins', ({ params, payload }) => boards.addPins(params.boardId, payload))
      .handle('removePins', ({ params, payload }) => boards.removePins(params.boardId, payload))
      .handle('keepLook', ({ params, payload }) => boards.keepLook(params.boardId, payload))
      .handle('setBoardVisibility', ({ params, payload }) => boards.setBoardVisibility(params.boardId, payload))
      .handle('addBoardImage', ({ params, payload }) => boards.addBoardImage(params.boardId, payload))
  }),
)
