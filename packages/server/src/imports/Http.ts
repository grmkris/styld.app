import { CurrentAccount, StyldApi } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Boards } from '../boards/Boards.ts'
import { Captures } from '../capture/Service.ts'
import { Imports } from './Imports.ts'

/** The admins' import endpoints, which the operator's importer calls. */
export const importHandlers = HttpApiBuilder.group(StyldApi, 'import', (handlers) =>
  Effect.map(Imports, (imports) =>
    handlers
      .handle('startImport', ({ params, payload }) => imports.startImport(params.importId, payload.operationId))
      .handle('importStatus', ({ params }) => imports.importStatus(params.importId)),
  ),
)

/** The operator's backfill of clean pictures, which the operator's script calls: the account the email signs in to,
 * then its pictures (`capture/Backfill.ts`). */
export const pictureBackfillHandlers = HttpApiBuilder.group(StyldApi, 'pictureBackfill', (handlers) =>
  Effect.gen(function* () {
    const imports = yield* Imports
    const captures = yield* Captures
    return handlers.handle('backfillPictures', ({ payload }) =>
      Effect.flatMap(imports.accountOf(payload.email), (accountId) =>
        Effect.map(
          captures.backfillPictures(
            accountId,
            Option.map(Option.fromUndefinedOr(payload.redrawBefore), (millis) => ({
              before: new Date(millis),
              which: payload.ended === true ? ('ended' as const) : ('every' as const),
            })),
            payload.backs ?? false,
          ),
          (done) => ({ accountId, ...done }),
        ),
      ),
    )
  }),
)

/** The operator's relayout of an account's outfit boards, which the operator's script calls: the account the email
 * signs in to, then its boards laid out again as that account (`boards/Template.ts` › `relayoutCentred`). */
export const boardRelayoutHandlers = HttpApiBuilder.group(StyldApi, 'boardRelayout', (handlers) =>
  Effect.gen(function* () {
    const imports = yield* Imports
    const boards = yield* Boards
    return handlers.handle('relayoutBoards', ({ payload }) =>
      Effect.flatMap(imports.accountOf(payload.email), (accountId) =>
        boards.relayoutCentred().pipe(
          Effect.map((done) => ({ accountId, ...done })),
          Effect.provideService(CurrentAccount, { accountId, via: 'assistant' }),
        ),
      ),
    )
  }),
)
