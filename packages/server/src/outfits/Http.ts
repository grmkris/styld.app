import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { type Admit, asSessionAccount } from '../wardrobe/Http.ts'
import { Outfits } from './Outfits.ts'

/** `POST /api/outfits`: a ranked batch for the session's account, admitted like a change since it counts against the
 * account's pace. */
export const outfitHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'outfits', (handlers) =>
    Effect.gen(function* () {
      const outfits = yield* Outfits
      return handlers.handle('makeOutfit', ({ payload }) => admit(asSessionAccount(outfits.make(payload))))
    }),
  )
