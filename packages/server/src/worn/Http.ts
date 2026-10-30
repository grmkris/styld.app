import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { type Admit, asSessionAccount } from '../wardrobe/Http.ts'
import { Worn } from './Worn.ts'

/** The website's worn-day endpoints, each the matching `Worn` operation for the session's account; changes are
 * admitted first. */
export const wornHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'worn', (handlers) =>
    Effect.gen(function* () {
      const worn = yield* Worn
      return handlers
        .handle('listWorn', ({ query }) =>
          asSessionAccount(worn.listWorn(query)).pipe(Effect.map((days) => ({ days }))),
        )
        .handle('wearPieces', ({ params, payload }) => admit(asSessionAccount(worn.wearPieces(params.day, payload))))
        .handle('clearWorn', ({ params }) => admit(asSessionAccount(worn.clearWorn(params.day))))
    }),
  )
