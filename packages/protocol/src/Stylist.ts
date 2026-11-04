import { Language } from './Languages.ts'
import { textLength, trimmedText } from './Text.ts'
import { entityId, OperationId } from './Ids.ts'
import { Schema } from 'effect'
import { passing } from './Errors.ts'
import { LookId } from './Look.ts'
import { GarmentGroup, PieceType } from './Garment.ts'
import { Colour, PieceId } from './Wardrobe.ts'
import { TryOnId } from './TryOn.ts'

// Styld, the stylist in the app (owner, 2026-10-31): a chat about the person's own wardrobe and looks.

export const ChatId = entityId('ch').pipe(Schema.brand('ChatId'))
export type ChatId = typeof ChatId.Type

/** What the person writes to Styld. */
export const ChatText = trimmedText(textLength.chat)

/** A message to Styld: in a chat, or starting one. Repeating its operation id returns the same chat and sends it once. */
export const SendChatMessage = Schema.Struct({
  operationId: OperationId,
  chatId: Schema.optionalKey(ChatId),
  text: ChatText,
  locale: Language,
})
export type SendChatMessage = typeof SendChatMessage.Type

export const ChatMessageSent = Schema.Struct({ chatId: ChatId })

/** The parts of a wardrobe "Analyze my wardrobe" weighs against each other, in the words people use (an outfit's slots,
 * without the sets worn on their own for sport, swimming or lounging). */
export const WardrobeArea = Schema.Literals(['tops', 'bottoms', 'dresses', 'layers', 'shoes', 'accessories'])
export type WardrobeArea = typeof WardrobeArea.Type

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** "Analyze my wardrobe" (Eva's review, T-14): what the wardrobe holds, counted exactly by the server, never by the
 * model. Groups, types and colours come commonest first; `worn` covers the last `days` days of the worn log. */
export const WardrobeAnalysis = Schema.Struct({
  pieces: Count,
  groups: Schema.Array(Schema.Struct({ group: GarmentGroup, count: Count })),
  types: Schema.Array(Schema.Struct({ type: PieceType, count: Count })),
  colours: Schema.Array(Schema.Struct({ colour: Colour, count: Count })),
  worn: Schema.Struct({
    days: Count,
    pieces: Count,
    never: Count,
    most: Schema.Array(Schema.Struct({ pieceId: PieceId, days: Count })),
  }),
  surpluses: Schema.Array(WardrobeArea),
  gaps: Schema.Array(WardrobeArea),
})
export type WardrobeAnalysis = typeof WardrobeAnalysis.Type

/** What a reply shows besides its words: pieces of the wardrobe, a look it saved, the wardrobe's analysis, or a try-on
 * it started or read (its picture is read by the website with the person's session, never by Styld). */
export const ReplyPart = Schema.Union([
  Schema.TaggedStruct('Pieces', { pieceIds: Schema.Array(PieceId) }),
  Schema.TaggedStruct('Look', { lookId: LookId, name: Schema.String }),
  Schema.TaggedStruct('Analysis', { analysis: WardrobeAnalysis }),
  Schema.TaggedStruct('TryOn', { tryOnId: TryOnId }),
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
  /** The Thread its replies are written in: what the chat's live words name (`/stylist/chats/:chatId/live`). */
  thread: Schema.String,
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
