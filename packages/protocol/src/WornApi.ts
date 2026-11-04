import { NotFound, OperationConflict, Unavailable } from './Errors.ts'
import { Operation } from './Ids.ts'
import { SessionHttp } from '@styld/auth/config'
import { SessionAccount } from './Session.ts'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Day } from './Day.ts'
import { WearPieces, WornDay, WornDays, WornRange } from './Worn.ts'

/** What the person wore, by day: "Wear this" on today's table records it. */
export class WornApi extends HttpApiGroup.make('worn')
  .add(
    HttpApiEndpoint.get('listWorn', '/worn', {
      query: WornRange,
      success: WornDays,
      error: Unavailable,
    }),
  )
  .add(
    HttpApiEndpoint.put('wearPieces', '/worn/:day', {
      params: { day: Day },
      payload: WearPieces,
      success: WornDay,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('clearWorn', '/worn/:day', {
      params: { day: Day },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
