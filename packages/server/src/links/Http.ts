import { SlowDown, StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpClient from 'effect/http/HttpClient'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { CurrentAccount } from '../CurrentAccount.ts'
import { publicClient } from '../mcp/ImageImport.ts'
import { type Admit, asSessionAccount } from '../wardrobe/Http.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { pictureFromLink } from './LinkPicture.ts'

/** The website's link endpoint: a shop's product page read into an upload, at the account's pace. */
export const linkHandlers = (
  admit: Admit,
  allowLink: (accountId: string) => Effect.Effect<boolean, never, RuntimeContext>,
) =>
  HttpApiBuilder.group(StyldApi, 'links', (handlers) =>
    Effect.gen(function* () {
      const wardrobe = yield* Wardrobe
      const http = yield* publicClient
      return handlers.handle('readLink', ({ payload }) =>
        admit(
          asSessionAccount(
            Effect.gen(function* () {
              const { accountId } = yield* CurrentAccount
              if (!(yield* allowLink(accountId))) return yield* SlowDown.make({})
              return yield* pictureFromLink(wardrobe, payload.url).pipe(
                Effect.provideService(HttpClient.HttpClient, http),
              )
            }),
          ),
        ),
      )
    }),
  )
