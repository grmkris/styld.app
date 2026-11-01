import { LimitReached, NotFound, OperationConflict, RequestRefused, Unavailable } from './Errors.ts'
import { SessionHttp } from '@styld/auth/config'
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
    HttpApiEndpoint.post('send', '/stylist/messages', {
      payload: SendChatMessage,
      success: ChatMessageSent,
      error: [NotFound, StylistBusy, LimitReached, OperationConflict, Unavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}
