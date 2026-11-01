import { StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { StylistChats } from './Service.ts'

/** The website's chat endpoints, each the matching stylist operation for the session's account. */
export const stylistHandlers = HttpApiBuilder.group(StyldApi, 'stylist', (handlers) =>
  Effect.gen(function* () {
    const stylist = yield* StylistChats
    return handlers
      .handle('chats', () => stylist.chats())
      .handle('chat', ({ params }) => stylist.chat(params.chatId))
      .handle('send', ({ payload }) => stylist.send(payload))
  }),
)
