import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { NotFound, Unavailable } from './Errors.ts'
import { OperationId } from './Ids.ts'
import { OperatorAuth } from './Operator.ts'

// The "One piece, many outfits" boards laid out again with their outfits centred in their places (Eva's report of
// 4 November 2026: holes in the table; owner: lay out the boards already made). The operator's script
// (`tools/once/relayout-boards.ts`) asks for one account at a time, by the email it signs in with. Only the operator, by the
// stage's operator token (`Operator.ts`), may ask; to anyone else it is not there.

/** Whose boards to lay out again: the account the email signs in to. Its operation id is not kept: each board's own
 * receipt is, so a repeat lays out nothing twice. */
export const BoardRelayout = Schema.Struct({
  operationId: OperationId,
  email: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(320)),
})
export type BoardRelayout = typeof BoardRelayout.Type

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** What one run did: the account's outfit boards, those laid out again, and those skipped (saved meanwhile, laid out
 * already, or with their piece gone). */
export const BoardsRelaid = Schema.Struct({
  accountId: Schema.String,
  boards: Count,
  relaid: Count,
  skipped: Count,
})
export type BoardsRelaid = typeof BoardsRelaid.Type

/** Outfit boards laid out again, for the operator. Running it again lays out nothing twice. */
export class BoardRelayoutApi extends HttpApiGroup.make('boardRelayout')
  .add(
    HttpApiEndpoint.post('relayoutBoards', '/operator/boards/relayout', {
      payload: BoardRelayout,
      success: BoardsRelaid,
      error: [NotFound, Unavailable],
    }),
  )
  .middleware(OperatorAuth) {}
