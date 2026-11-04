import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { BoardId } from './Board.ts'
import { PieceType } from './Garment.ts'
import { Colours } from './Wardrobe.ts'
import { NotFound, OperationConflict, Unavailable } from './Errors.ts'
import { OperationId } from './Ids.ts'
import { SessionAccount } from './Session.ts'

// Try with my wardrobe (owner, 4 November 2026): a house board's generated pieces swapped for the person's own, as a
// new private board of theirs. The house's pieces never go on it and nothing is written to their wardrobe.

/** Try a public board that shows generated pieces: `POST /api/boards/:boardId/try`. */
export const TryBoard = Schema.Struct({ operationId: OperationId })
export type TryBoard = typeof TryBoard.Type

/** A kind of piece the person's wardrobe had none of for the board: what to add (owner, 4 November 2026). */
export const MissingPiece = Schema.Struct({ type: PieceType, colours: Colours })
export type MissingPiece = typeof MissingPiece.Type

/** The person's new private board, how many of the board's pieces came from their wardrobe, of how many, and the
 * kinds of piece it had none of. Tries kept before `missing` existed answer without it. */
export const TriedBoard = Schema.Struct({
  boardId: BoardId,
  fromWardrobe: Schema.Int,
  of: Schema.Int,
  missing: Schema.optionalKey(Schema.Array(MissingPiece)),
})
export type TriedBoard = typeof TriedBoard.Type

/** Trying a board with one's own wardrobe. A board that is not public, or shows nothing generated, is not found. */
export class TryBoardApi extends HttpApiGroup.make('tryBoard')
  .add(
    HttpApiEndpoint.post('tryBoard', '/boards/:boardId/try', {
      params: { boardId: BoardId },
      payload: TryBoard,
      success: TriedBoard,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
