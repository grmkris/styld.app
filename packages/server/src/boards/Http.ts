import { BoardImageId, StyldApi } from '@styld/protocol'
import { Effect, Layer, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { makeAuthHttp } from '../AuthHttp.ts'
import { type Admit, asSessionAccount, ownerImage, ShownSize } from '../wardrobe/Http.ts'
import { Boards } from './Boards.ts'

/** The website's board endpoints, each the matching `Boards` operation for the session's account; changes are
 * admitted first. */
export const boardHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'board', (handlers) =>
    Effect.gen(function* () {
      const boards = yield* Boards
      return handlers
        .handle('listBoards', () =>
          asSessionAccount(boards.listBoards()).pipe(Effect.map((found) => ({ boards: found }))),
        )
        .handle('createBoard', ({ payload }) => admit(asSessionAccount(boards.createBoard(payload))))
        .handle('getBoard', ({ params }) => asSessionAccount(boards.getBoard(params.boardId)))
        .handle('updateBoard', ({ params, payload }) =>
          admit(asSessionAccount(boards.updateBoard(params.boardId, payload))),
        )
        .handle('deleteBoard', ({ params }) => admit(asSessionAccount(boards.deleteBoard(params.boardId))))
        .handle('saveBoardItems', ({ params, payload }) =>
          admit(asSessionAccount(boards.saveBoardItems(params.boardId, payload))),
        )
        .handle('addPins', ({ params, payload }) => admit(asSessionAccount(boards.addPins(params.boardId, payload))))
        .handle('removePins', ({ params, payload }) =>
          admit(asSessionAccount(boards.removePins(params.boardId, payload))),
        )
        .handle('addBoardImage', ({ params, payload }) =>
          admit(asSessionAccount(boards.addBoardImage(params.boardId, payload))),
        )
    }),
  )

const PictureTarget = Schema.Struct({ imageId: BoardImageId, size: ShownSize })

/** `GET /cdn/boards/images/:imageId/:size`: a board's picture for its owner only. */
export const boardRoutes = (auth: ReturnType<typeof makeAuthHttp>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const boards = yield* Boards
      const handler = yield* ownerImage(auth, PictureTarget, ({ imageId, size }) => boards.boardImage(imageId, size))
      return HttpRouter.add('GET', '/cdn/boards/images/:imageId/:size', handler)
    }),
  )
