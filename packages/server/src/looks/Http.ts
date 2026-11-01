import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Looks } from './Looks.ts'

/** The website's look endpoints, each the matching `Looks` operation for the session's account. */
export const lookHandlers = HttpApiBuilder.group(StyldApi, 'look', (handlers) =>
  Effect.gen(function* () {
    const looks = yield* Looks
    return handlers
      .handle('listLooks', () => looks.listLooks().pipe(Effect.map((found) => ({ looks: found }))))
      .handle('createLook', ({ payload }) => looks.createLook(payload))
      .handle('getLook', ({ params }) => looks.getLook(params.lookId))
      .handle('shareLook', ({ params, payload }) => looks.shareLook(params.lookId, payload))
      .handle('deleteLook', ({ params, payload }) => looks.deleteLook(params.lookId, payload.operationId))
  }),
)
