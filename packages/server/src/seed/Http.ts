import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Seeding } from './Seeding.ts'

/** The house boards' endpoints, which the operator's seed calls (`tools/seed/Run.ts`). */
export const seedHandlers = HttpApiBuilder.group(StyldApi, 'seed', (handlers) =>
  Effect.map(Seeding, (seeding) =>
    handlers
      .handle('seedProfile', ({ payload }) => seeding.seedProfile(payload))
      .handle('seedBoard', ({ params, payload }) => seeding.seedBoard(params.seedId, payload))
      .handle('seededBoard', ({ params, query }) => seeding.seededBoard(params.seedId, query.email))
      .handle('removeSeededBoard', ({ params, payload }) => seeding.removeSeededBoard(params.seedId, payload))
      .handle('seedPieces', ({ query }) => seeding.seedPieces(query.email)),
  ),
)
