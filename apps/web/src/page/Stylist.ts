import { Chat, ChatId, ChatLocale, ChatSummary, OperationId } from '@styld/protocol'
import { Duration, Effect, Option, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { AsyncData, Command, Dom, Render, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// MODEL

/** Why a message did not go: Styld is still answering, the day's allowance is spent, it cannot answer just now, or the
 * network failed (sending again repeats the same message). */
export const SendProblem = Schema.Literals(['busy', 'dailyLimit', 'unavailable', 'network'])
export type SendProblem = typeof SendProblem.Type

/** A message on its way, or why the last one did not go; a failure that may not have reached Styld keeps its operation
 * id, so sending again repeats the same message. */
export const Sending = defineTaggedUnion({
  Idle: {},
  Sending: {},
  Failed: { problem: SendProblem, operationId: Schema.Option(Schema.String) },
})
export type Sending = typeof Sending.Type

const ChatsData = AsyncData.Schema(Schema.Array(ChatSummary), Schema.Literal('Unavailable'))

/** The chat being read to open (`pressed` when the person chose it, so focus follows it there), or the one that did
 * not open, to try again. */
export const Opening = defineTaggedUnion({
  None: {},
  Reading: { chatId: Schema.String, pressed: Schema.Boolean },
  Failed: { chatId: Schema.String },
})
export type Opening = typeof Opening.Type

/** Styld, the stylist in the app: the chat open (none for a new one), the earlier chats, and what is being written. */
export const Model = Schema.Struct({
  chats: ChatsData.schema,
  open: Schema.Option(Chat),
  opening: Opening,
  draft: Schema.String,
  sending: Sending,
})
export type Model = typeof Model.Type

export const init = (draft: Option.Option<string>): Model => ({
  chats: AsyncData.Idle(),
  open: Option.none(),
  opening: Opening.None(),
  draft: Option.getOrElse(draft, () => ''),
  sending: Sending.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadChats: { chats: Schema.Array(ChatSummary) },
  FailedLoadChats: {},
  SucceededLoadChat: { chat: Chat },
  FailedLoadChat: { chatId: Schema.String },
  SucceededRefreshChat: { chat: Chat },
  FailedRefreshChat: { chatId: Schema.String },
  UpdatedDraft: { value: Schema.String },
  SubmittedMessage: { locale: ChatLocale },
  ClickedStarter: { text: Schema.String, locale: ChatLocale },
  SucceededSend: { chatId: ChatId },
  FailedSend: { problem: SendProblem, operationId: Schema.Option(Schema.String) },
  ClickedNewChat: {},
  ClickedChat: { chatId: Schema.String },
  ClickedRetryLoad: {},
  CompletedScrollToLatest: {},
  CompletedStartAtTop: {},
  CompletedFocusThread: {},
})
export type Message = typeof Message.Type

// COMMAND

/** While Styld writes, the chat is read again this often. */
const replyPause = Duration.millis(800)

/** @internal Exported for its tests. */
export const LoadChats = Command.define('LoadChats', {
  messages: [Message.SucceededLoadChats, Message.FailedLoadChats],
  execute: Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return Message.SucceededLoadChats({ chats: (yield* api.stylist.chats()).chats })
  }).pipe(Effect.orElseSucceed(() => Message.FailedLoadChats())),
})

const readChat = (chatId: string) =>
  Effect.gen(function* () {
    const api = yield* (yield* StyldClient).api
    return yield* api.stylist.chat({ params: { chatId: yield* Schema.decodeUnknownEffect(ChatId)(chatId) } })
  })

/** @internal Exported for its tests. */
export const LoadChat = Command.define('LoadChat', {
  args: { chatId: Schema.String },
  messages: [Message.SucceededLoadChat, Message.FailedLoadChat],
  execute: ({ chatId }) =>
    readChat(chatId).pipe(
      Effect.map((chat) => Message.SucceededLoadChat({ chat })),
      Effect.orElseSucceed(() => Message.FailedLoadChat({ chatId })),
    ),
})

/** The chat again after a pause, while Styld writes its reply.
 * @internal Exported for its tests. */
export const RefreshChat = Command.define('RefreshChat', {
  args: { chatId: Schema.String },
  messages: [Message.SucceededRefreshChat, Message.FailedRefreshChat],
  execute: ({ chatId }) =>
    readChat(chatId).pipe(
      Effect.delay(replyPause),
      Effect.map((chat) => Message.SucceededRefreshChat({ chat })),
      Effect.orElseSucceed(() => Message.FailedRefreshChat({ chatId })),
    ),
})

const refused = (problem: SendProblem) => () =>
  Effect.succeed(Message.FailedSend({ problem, operationId: Option.none() }))

/** Send the message to Styld, in the chat open or a new one, under a new operation id or the one a lost send had.
 * @internal Exported for its tests. */
export const SendMessage = Command.define('SendMessage', {
  args: {
    operationId: Schema.Option(Schema.String),
    chatId: Schema.Option(Schema.String),
    text: Schema.String,
    locale: ChatLocale,
  },
  messages: [Message.SucceededSend, Message.FailedSend],
  execute: ({ operationId, chatId, text, locale }) =>
    Effect.gen(function* () {
      const drawn = Option.isSome(operationId) ? operationId.value : yield* (yield* Crypto.Crypto).randomUUIDv4()
      const sent = Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        const { chatId: sentTo } = yield* api.stylist.send({
          payload: {
            operationId: yield* Schema.decodeUnknownEffect(OperationId)(drawn),
            text: text.trim(),
            locale,
            ...Option.match(chatId, {
              onNone: () => ({}),
              onSome: (id) => ({ chatId: ChatId.make(id) }),
            }),
          },
        })
        return Message.SucceededSend({ chatId: sentTo })
      })
      return yield* sent.pipe(
        Effect.catchTags({
          StylistBusy: refused('busy'),
          DailyLimitReached: refused('dailyLimit'),
          StylistUnavailable: refused('unavailable'),
          ChatNotFound: refused('unavailable'),
        }),
        Effect.orElseSucceed(() => Message.FailedSend({ problem: 'network', operationId: Option.some(drawn) })),
      )
    }).pipe(Effect.orElseSucceed(() => Message.FailedSend({ problem: 'network', operationId: Option.none() }))),
})

/** The Commands that open the page. */
export const load = () => [LoadChats()]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient | Crypto.Crypto>

/** Whether Styld is writing the open chat's reply. */
export const isWriting = (model: Model) => Option.exists(model.open, (chat) => chat.replying?.state === 'writing')

/** Whether a message can go now: something written, nothing on its way, and no reply being written. */
export const canSend = (model: Model) =>
  model.draft.trim().length > 0 && !isWriting(model) && !Sending.guards.Sending(model.sending)

/** The element after the thread that the newest message is scrolled to, clear of the composer. */
export const latestId = 'stylist-latest'
/** The open chat's thread. */
export const threadId = 'stylist-thread'

/** Bring the newest message into view above the composer: when a chat opens and when a reply lands, never while
 * one is being written, so it does not pull the page from under someone reading back.
 * @internal Exported for its tests. */
export const ScrollToLatest = Command.define('ScrollToLatest', {
  messages: [Message.CompletedScrollToLatest],
  execute: Dom.scrollIntoViewAfterPaint(`#${latestId}`, { block: 'end' }).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedScrollToLatest()),
  ),
})

/** A new chat starts at the top of the page with its title focused, as a page opened from the navigation does
 * (Navigation.ts): New chat removes itself, and the chat it leaves may have been scrolled far down.
 * @internal Exported for its tests. */
export const StartAtTop = Command.define('StartAtTop', {
  messages: [Message.CompletedStartAtTop],
  execute: Effect.gen(function* () {
    yield* Render.afterCommit
    window.scrollTo({ top: 0, behavior: 'instant' })
    yield* Dom.focus('#main h1', { preventScroll: true, makeFocusable: true }).pipe(Effect.ignore)
    return Message.CompletedStartAtTop()
  }),
})

/** The thread a press opened takes focus, so keyboard and screen reader follow it from the earlier chat pressed,
 * which is gone; the newest message is still what is scrolled to.
 * @internal Exported for its tests. */
export const FocusThread = Command.define('FocusThread', {
  messages: [Message.CompletedFocusThread],
  execute: Dom.focus(`#${threadId}`, { preventScroll: true, makeFocusable: true }).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusThread()),
  ),
})

/** A chat read: shown when it is still the one open, and read again while its reply is written. */
const showChat = (model: Model, chat: Chat): UpdateReturn => {
  const current = Option.exists(model.open, ({ id }) => id === chat.id)
  if (!current) return { model }
  return {
    model: modifyFields(model, { open: () => Option.some(chat) }),
    commands: chat.replying?.state === 'writing' ? [RefreshChat({ chatId: chat.id })] : [],
  }
}

/** Send what is written: a message lost on the network goes again as the same one. */
const submit = (model: Model, locale: ChatLocale): UpdateReturn => {
  if (!canSend(model)) return { model }
  return {
    model: modifyFields(model, { sending: () => Sending.Sending() }),
    commands: [
      SendMessage({
        operationId: Sending.guards.Failed(model.sending) ? model.sending.operationId : Option.none(),
        chatId: Option.map(model.open, ({ id }) => id),
        text: model.draft,
        locale,
      }),
    ],
  }
}

/** Opening a chat: the one asked for, read whole; the one open stays while it is read again. */
const openChat = (model: Model, chatId: string, pressed = false): UpdateReturn => ({
  model: modifyFields(model, {
    open: Option.filter(({ id }) => id === chatId),
    opening: () => Opening.Reading({ chatId, pressed }),
  }),
  commands: [LoadChat({ chatId })],
})

const isReading = (model: Model, chatId: string) =>
  Opening.guards.Reading(model.opening) && model.opening.chatId === chatId

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    // On arrival the latest chat opens, unless the person came to ask something new; the list read again after a
    // message only updates the titles.
    SucceededLoadChats: ({ chats }) => {
      const loaded = modifyFields(model, { chats: () => ChatsData.Success({ data: chats }) })
      const [latest] = chats
      return latest === undefined ||
        AsyncData.isSuccess(model.chats) ||
        model.draft.length > 0 ||
        Option.isSome(model.open) ||
        !Opening.guards.None(model.opening)
        ? { model: loaded }
        : openChat(loaded, latest.id)
    },
    FailedLoadChats: () => ({
      model: modifyFields(model, { chats: () => ChatsData.Failure({ error: 'Unavailable' }) }),
    }),
    // Only the chat still asked for opens: one left for another, or a new chat, is dropped.
    SucceededLoadChat: ({ chat }) => {
      if (!isReading(model, chat.id)) return { model }
      const pressed = Opening.guards.Reading(model.opening) && model.opening.pressed
      const shown = showChat(
        modifyFields(model, { open: () => Option.some(chat), opening: () => Opening.None() }),
        chat,
      )
      return {
        ...shown,
        commands: [...(shown.commands ?? []), ScrollToLatest(), ...(pressed ? [FocusThread()] : [])],
      }
    },
    FailedLoadChat: ({ chatId }) =>
      isReading(model, chatId)
        ? { model: modifyFields(model, { opening: () => Opening.Failed({ chatId }) }) }
        : { model },
    SucceededRefreshChat: ({ chat }) => {
      const before = Option.match(model.open, { onNone: () => 0, onSome: ({ messages }) => messages.length })
      const shown = showChat(model, chat)
      return chat.messages.length > before
        ? { ...shown, commands: [...(shown.commands ?? []), ScrollToLatest()] }
        : shown
    },
    CompletedScrollToLatest: () => ({ model }),
    // A failed read keeps the chat shown and asks again.
    FailedRefreshChat: ({ chatId }) =>
      Option.exists(model.open, ({ id }) => id === chatId) ? { model, commands: [RefreshChat({ chatId })] } : { model },
    // Changing what is written makes it a new message, not the one a lost send would repeat.
    UpdatedDraft: ({ value }) => ({
      model: modifyFields(model, {
        draft: () => value,
        sending: (sending) => (Sending.guards.Failed(sending) ? Sending.Idle() : sending),
      }),
    }),
    SubmittedMessage: ({ locale }) => submit(model, locale),
    ClickedStarter: ({ text, locale }) =>
      Sending.guards.Sending(model.sending)
        ? { model }
        : submit(modifyFields(model, { draft: () => text, sending: () => Sending.Idle() }), locale),
    // The message is in: the chat is read with it, and the list for its title.
    SucceededSend: ({ chatId }) => {
      const opened = openChat(modifyFields(model, { draft: () => '', sending: () => Sending.Idle() }), chatId)
      return { model: opened.model, commands: [...(opened.commands ?? []), LoadChats()] }
    },
    FailedSend: ({ problem, operationId }) => ({
      model: modifyFields(model, { sending: () => Sending.Failed({ problem, operationId }) }),
    }),
    ClickedNewChat: () => ({
      model: modifyFields(model, {
        open: () => Option.none(),
        opening: () => Opening.None(),
        draft: () => '',
        sending: () => Sending.Idle(),
      }),
      commands: [StartAtTop()],
    }),
    CompletedStartAtTop: () => ({ model }),
    CompletedFocusThread: () => ({ model }),
    ClickedChat: ({ chatId }) => openChat(model, chatId, true),
    ClickedRetryLoad: () =>
      Opening.guards.Failed(model.opening)
        ? openChat(model, model.opening.chatId, true)
        : { model, commands: [LoadChats()] },
  })
