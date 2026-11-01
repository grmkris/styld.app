import { StyldApi } from '@styld/protocol'
import { Context, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import type { StylistService } from './Service.ts'

/** The stylist service, for the routes and the queue. */
export class StylistChats extends Context.Service<StylistChats, StylistService>()('@styld/server/StylistChats') {}

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
