import { StyldApi } from '@styld/protocol'
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
        .handle('getLook', ({ params }) => asSessionAccount(looks.getLook(params.lookId)))
        .handle('deleteLook', ({ params }) => admit(asSessionAccount(looks.deleteLook(params.lookId))))
    }),
  )
