import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { StylistChats } from './Service.ts'

/** The website's chat endpoints, each the matching stylist operation for the session's account. */
export const stylistHandlers = HttpApiBuilder.group(StyldApi, 'stylist', (handlers) =>
  Effect.gen(function* () {
    const stylist = yield* StylistChats
    return handlers
      .handle('chats', () => stylist.chats())
      .handle('chat', ({ params }) => stylist.chat(params.chatId))
      .handle('live', ({ params }) =>
        Effect.map(stylist.live(params.chatId), (words) =>
          HttpServerResponse.stream(words, {
            contentType: 'application/x-ndjson',
            headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
          }),
        ),
      )
      .handle('send', ({ payload }) => stylist.send(payload))
  }),
)
