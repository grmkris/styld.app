import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Tastes } from './Taste.ts'

/** What Styld knows about the person, for the website: each endpoint the matching `Tastes` operation for the session's
 * account; changes are admitted first. */
export const tasteHandlers = HttpApiBuilder.group(StyldApi, 'taste', (handlers) =>
  Effect.gen(function* () {
    const tastes = yield* Tastes
    return handlers
      .handle('getTaste', () => tastes.getTaste())
      .handle('setOccasions', ({ payload }) => tastes.setOccasions(payload))
      .handle('addStyleNote', ({ payload }) => tastes.addStyleNote(payload))
      .handle('deleteStyleNote', ({ params, payload }) => tastes.deleteStyleNote(params.noteId, payload.operationId))
      .handle('finishFirstRun', ({ payload }) => tastes.finishFirstRun(payload.operationId))
  }),
)
