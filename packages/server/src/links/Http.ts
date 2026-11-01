import { CurrentAccount, SlowDown, StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpClient from 'effect/http/HttpClient'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { publicClient } from '../mcp/ImageImport.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { readLink } from './LinkPicture.ts'

/** The website's link endpoint: a shop's product page read into an upload, at the account's pace. */
export const linkHandlers = (allowLink: (accountId: string) => Effect.Effect<boolean, never, RuntimeContext>) =>
  HttpApiBuilder.group(StyldApi, 'link', (handlers) =>
    Effect.gen(function* () {
      const wardrobe = yield* Wardrobe
      const http = yield* publicClient
      return handlers.handle('readLink', ({ payload }) =>
        Effect.gen(function* () {
          const { accountId } = yield* CurrentAccount
          if (!(yield* allowLink(accountId))) return yield* SlowDown.make({})
          return yield* readLink(wardrobe, payload).pipe(Effect.provideService(HttpClient.HttpClient, http))
        }),
      )
    }),
  )
