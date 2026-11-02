import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Imports } from './Imports.ts'

/** The admins' import endpoints, which the operator's importer calls. */
export const importHandlers = HttpApiBuilder.group(StyldApi, 'import', (handlers) =>
  Effect.map(Imports, (imports) =>
    handlers
      .handle('startImport', ({ params, payload }) => imports.startImport(params.importId, payload.operationId))
      .handle('importStatus', ({ params }) => imports.importStatus(params.importId)),
  ),
)
