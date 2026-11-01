import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Outfits } from './Outfits.ts'

/** `POST /api/outfits`: a ranked batch for the session's account, admitted like a change since it counts against the
 * account's pace. */
export const outfitHandlers = HttpApiBuilder.group(StyldApi, 'outfit', (handlers) =>
  Effect.gen(function* () {
    const outfits = yield* Outfits
    return handlers.handle('makeOutfit', ({ payload }) => outfits.make(payload))
  }),
)
