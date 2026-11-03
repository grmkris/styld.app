import { LimitReached, NotFound, OperationConflict, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
import { SessionAccount } from './Session.ts'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Chat, ChatId, ChatMessageSent, Chats, SendChatMessage, StylistBusy } from './Stylist.ts'

/** Styld, the stylist in the app: the person's chats, and a message that Styld answers on the queue. */
export class StylistApi extends HttpApiGroup.make('stylist')
  .add(HttpApiEndpoint.get('chats', '/stylist/chats', { success: Chats, error: Unavailable }))
  .add(
    HttpApiEndpoint.get('chat', '/stylist/chats/:chatId', {
      params: { chatId: ChatId },
      success: Chat,
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    // The chat's live words while Styld writes a reply: Yielded LiveText NDJSON, read by the page's own decoder.
    HttpApiEndpoint.get('live', '/stylist/chats/:chatId/live', {
      params: { chatId: ChatId },
      error: [NotFound, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('send', '/stylist/messages', {
      payload: SendChatMessage,
      success: ChatMessageSent,
      error: [NotFound, StylistBusy, LimitReached, OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
