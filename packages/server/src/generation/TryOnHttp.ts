import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { TryOns } from './TryOn.ts'

/** The website's try-on endpoints: starting one, reading how it goes, deleting it and putting it on a board. */
export const tryOnHandlers = HttpApiBuilder.group(StyldApi, 'tryOn', (handlers) =>
  Effect.map(TryOns, (tryOns) =>
    handlers
      .handle('listTryOns', () => tryOns.list())
      .handle('startTryOn', ({ payload }) => tryOns.start(payload))
      .handle('getTryOn', ({ params }) => tryOns.get(params.tryOnId))
      .handle('deleteTryOn', ({ params, payload }) => tryOns.delete(params.tryOnId, payload.operationId))
      .handle('addTryOnToBoard', ({ params, payload }) => tryOns.toBoard(params.tryOnId, payload)),
  ),
)
