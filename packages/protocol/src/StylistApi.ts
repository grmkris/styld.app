import { SessionHttp } from '@styld/auth/config'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { RequestRefused } from './Account.ts'
import { DailyLimitReached } from './Capture.ts'
import {
  Chat,
  ChatId,
  ChatMessageSent,
  ChatNotFound,
  Chats,
  SendChatMessage,
  StylistBusy,
  StylistUnavailable,
} from './Stylist.ts'
import { OperationConflict } from './Wardrobe.ts'

/** Styld, the stylist in the app: the person's chats, and a message that Styld answers on the queue. */
export class StylistApi extends HttpApiGroup.make('stylist')
  .add(HttpApiEndpoint.get('chats', '/stylist/chats', { success: Chats, error: StylistUnavailable }))
  .add(
    HttpApiEndpoint.get('chat', '/stylist/chats/:chatId', {
      params: { chatId: ChatId },
      success: Chat,
      error: [ChatNotFound, StylistUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('send', '/stylist/messages', {
      payload: SendChatMessage,
      success: ChatMessageSent,
      error: [ChatNotFound, StylistBusy, DailyLimitReached, OperationConflict, StylistUnavailable, RequestRefused],
    }),
  )
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}
