import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { NotFound, OperationConflict, Unavailable } from './Errors.ts'
import { OperationId } from './Ids.ts'
import { OperatorAuth } from './Operator.ts'

// Finding an account's outfit photos again, for the operator (Eva, 4 November): her photos were found by the detector
// before it looked for the person nearest the camera. The operator names the account by its email; each ready photo is
// found again at Styld's cost, never the person's credits. What the person confirmed, sent to the review tray or added
// by hand stays; only Styld's own guesses are replaced. The operation id is the round: the same id again answers what
// it queued and finds nothing twice, a new id finds the photos again.

const email = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(320))
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** Find the account's photos again: `POST /api/operator/photos/refind`. */
export const RefindPhotos = Schema.Struct({ operationId: OperationId, email })
export type RefindPhotos = typeof RefindPhotos.Type

/** An account's outfit photos in counts, never names or pictures; `queued` is how many a re-find sent. */
export const PhotoCounts = Schema.Struct({
  photos: count,
  ready: count,
  empty: count,
  garments: count,
  confirmed: count,
  suggested: count,
  unmatched: count,
  offered: count,
  queued: count,
})
export type PhotoCounts = typeof PhotoCounts.Type

/** My Gallery's photos, for the operator. */
export class GalleryOperatorApi extends HttpApiGroup.make('galleryOperator')
  .add(
    HttpApiEndpoint.post('refindPhotos', '/operator/photos/refind', {
      payload: RefindPhotos,
      success: PhotoCounts,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.get('photoCounts', '/operator/photos', {
      query: { email },
      success: PhotoCounts,
      error: [NotFound, Unavailable],
    }),
  )
  .middleware(OperatorAuth) {}
