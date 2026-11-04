import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { NotFound, Unavailable } from './Errors.ts'
import { OperationId } from './Ids.ts'
import { OperatorAuth } from './Operator.ts'

// A shop-style picture for every piece (owner, 4 November 2026): most of a tester's pieces were kept before clean
// pictures were drawn, or came over from v1, and never had one. The operator's script (`tools/backfill-pictures.ts`)
// asks for them, one account at a time, by the email it signs in with; Styld pays, never the person's credits. Only
// the operator, by the stage's operator token (`Operator.ts`), may ask; to anyone else it is not there.

/** Whose pieces to draw: the account the email signs in to. Its operation id is not kept: each run queues what is
 * still missing, and a piece's picture row is its receipt, so a repeat queues nothing twice. */
export const PictureBackfill = Schema.Struct({
  operationId: OperationId,
  email: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(320)),
})
export type PictureBackfill = typeof PictureBackfill.Type

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** What one run did, in counts: pictures queued now, drawings proposed before 4 November now shown, and the pieces
 * that still have none because one run queues at most so many (run it again once these are drawn). */
export const PictureBackfilled = Schema.Struct({
  accountId: Schema.String,
  queued: Count,
  shown: Count,
  remaining: Count,
})
export type PictureBackfilled = typeof PictureBackfilled.Type

/** Clean pictures, for the operator. Running it again queues nothing twice. */
export class PictureBackfillApi extends HttpApiGroup.make('pictureBackfill')
  .add(
    HttpApiEndpoint.post('backfillPictures', '/operator/pictures/backfill', {
      payload: PictureBackfill,
      success: PictureBackfilled,
      error: [NotFound, Unavailable],
    }),
  )
  .middleware(OperatorAuth) {}
