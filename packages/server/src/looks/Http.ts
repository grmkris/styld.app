import { OperationConflict, StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { type Admit, asSessionAccount } from '../wardrobe/Http.ts'
import { Looks } from './Looks.ts'

/** The website's look endpoints, each the matching `Looks` operation for the session's account. */
export const lookHandlers = (admit: Admit) =>
  HttpApiBuilder.group(StyldApi, 'look', (handlers) =>
    Effect.gen(function* () {
      const looks = yield* Looks
      return handlers
        .handle('listLooks', () => asSessionAccount(looks.listLooks()).pipe(Effect.map((found) => ({ looks: found }))))
        .handle('createLook', ({ payload }) =>
          admit(
            asSessionAccount(
              looks.createLook(payload).pipe(
                // A repeat of an operation whose look was deleted since: the id is spent, a new look needs a new one.
                Effect.catchTag('LookNotFound', () => Effect.fail(OperationConflict.make({}))),
              ),
            ),
          ),
        )
        .handle('getLook', ({ params }) => asSessionAccount(looks.getLook(params.lookId)))
        .handle('deleteLook', ({ params }) => admit(asSessionAccount(looks.deleteLook(params.lookId))))
    }),
  )
