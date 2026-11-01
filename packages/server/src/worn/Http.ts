import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Worn } from './Worn.ts'

/** The website's worn-day endpoints, each the matching `Worn` operation for the session's account; changes are
 * admitted first. */
export const wornHandlers = HttpApiBuilder.group(StyldApi, 'worn', (handlers) =>
  Effect.gen(function* () {
    const worn = yield* Worn
    return handlers
      .handle('listWorn', ({ query }) => worn.listWorn(query).pipe(Effect.map((days) => ({ days }))))
      .handle('wearPieces', ({ params, payload }) => worn.wearPieces(params.day, payload))
      .handle('clearWorn', ({ params }) => worn.clearWorn(params.day))
  }),
)
