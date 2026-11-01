import { BoardImageId, StyldApi } from '@styld/protocol'
import { Effect, Layer, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { AuthHttp } from '../AuthHttp.ts'
import { ownerImage, ShownSize } from '../wardrobe/Http.ts'
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
      .handle('deleteBoard', ({ params }) => boards.deleteBoard(params.boardId))
      .handle('saveBoardItems', ({ params, payload }) => boards.saveBoardItems(params.boardId, payload))
      .handle('addPins', ({ params, payload }) => boards.addPins(params.boardId, payload))
      .handle('removePins', ({ params, payload }) => boards.removePins(params.boardId, payload))
      .handle('setBoardVisibility', ({ params, payload }) => boards.setBoardVisibility(params.boardId, payload))
      .handle('addBoardImage', ({ params, payload }) => boards.addBoardImage(params.boardId, payload))
  }),
)

const PictureTarget = Schema.Struct({ imageId: BoardImageId, size: ShownSize })

/** `GET /cdn/boards/images/:imageId/:size`: a board's picture for its owner only. */
export const boardRoutes = (auth: AuthHttp) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const boards = yield* Boards
      const handler = yield* ownerImage(auth, PictureTarget, ({ imageId, size }) => boards.boardImage(imageId, size))
      return HttpRouter.add('GET', '/cdn/boards/images/:imageId/:size', handler)
    }),
  )
