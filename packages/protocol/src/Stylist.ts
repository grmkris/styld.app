import { textLength, trimmedText } from './Text.ts'
import { entityId, OperationId } from './Ids.ts'
import { Schema } from 'effect'
import { passing } from './Errors.ts'
import { LookId } from './Look.ts'
import { PieceId } from './Wardrobe.ts'

// Styld, the stylist in the app (owner, 2026-10-31): a chat about the person's own wardrobe and looks.

export const ChatId = entityId('ch').pipe(Schema.brand('ChatId'))
export type ChatId = typeof ChatId.Type

/** What the person writes to Styld. */
export const ChatText = trimmedText(textLength.chat)

/** The languages Styld answers in. */
export const ChatLocale = Schema.Literals(['en', 'sl'])
export type ChatLocale = typeof ChatLocale.Type

/** A message to Styld: in a chat, or starting one. Repeating its operation id returns the same chat and sends it once. */
export const SendChatMessage = Schema.Struct({
  operationId: OperationId,
  chatId: Schema.optionalKey(ChatId),
  text: ChatText,
  locale: ChatLocale,
})
export type SendChatMessage = typeof SendChatMessage.Type

export const ChatMessageSent = Schema.Struct({ chatId: ChatId })

/** What a reply shows besides its words: pieces of the wardrobe, or a look it saved. */
export const ReplyPart = Schema.Union([
  Schema.TaggedStruct('Pieces', { pieceIds: Schema.Array(PieceId) }),
  Schema.TaggedStruct('Look', { lookId: LookId, name: Schema.String }),
])
export type ReplyPart = typeof ReplyPart.Type

export const ChatMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(['person', 'styld']),
  text: Schema.String,
  parts: Schema.Array(ReplyPart),
  at: Schema.String,
})
export type ChatMessage = typeof ChatMessage.Type

/** The reply to the chat's last message while Styld writes it, or that it did not come (its credit came back). */
export const Replying = Schema.Struct({
  state: Schema.Literals(['writing', 'failed']),
  text: Schema.String,
  parts: Schema.Array(ReplyPart),
})
export type Replying = typeof Replying.Type

export const Chat = Schema.Struct({
  id: ChatId,
  title: Schema.String,
  messages: Schema.Array(ChatMessage),
  replying: Schema.optionalKey(Replying),
})
export type Chat = typeof Chat.Type

export const ChatSummary = Schema.Struct({ id: ChatId, title: Schema.String, updatedAt: Schema.String })
export type ChatSummary = typeof ChatSummary.Type

/** The person's chats, the latest first. */
export const Chats = Schema.Struct({ chats: Schema.Array(ChatSummary) })
export type Chats = typeof Chats.Type

/** Styld is still answering the last message: one reply at a time. */
export class StylistBusy extends Schema.TaggedError<StylistBusy>()(
  'StylistBusy',
  {},
  {
    httpApiStatus: 409,
    guide: passing('stylist_busy', 'Styld is still answering the last message.', 'Wait for the reply, then ask again.'),
  },
) {}
