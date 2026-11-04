import { drawOperationId } from '../OperationIds.ts'
import { Chat, ChatId, Language, ChatSummary, OperationId } from '@styld/protocol'
import { Duration, Effect, Number, Option, Schema, Stream } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { AsyncData, Command, Dom, Render, Subscription, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { hasStopped, Misses } from '../Polling.ts'
import * as HttpClient from 'effect/http/HttpClient'
import { StyldClient } from '../StyldClient.ts'
import * as StylistTryOns from './StylistTryOns.ts'

// MODEL

/** Why a message did not go: Styld is still answering, the day's allowance is spent, it cannot answer just now, or the
 * network failed (sending again repeats the same message). */
export const SendProblem = Schema.Literals(['busy', 'dailyLimit', 'unavailable', 'network'])
export type SendProblem = typeof SendProblem.Type

/** A message on its way (`fromStarter` when a starter question sent it: that button goes as the chat opens, so focus
 * follows to the thread), or why the last one did not go; a failure that may not have reached Styld keeps its
 * operation id, so sending again repeats the same message. */
export const Sending = defineTaggedUnion({
  Idle: {},
  Sending: { fromStarter: Schema.Boolean },
  Failed: { problem: SendProblem, operationId: Schema.Option(OperationId) },
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

/** The open chat read again once its reply's attempt ended: nothing on its way, or a read on its way. */
const Refresh = defineTaggedUnion({ Idle: {}, Reading: {} })
type Refresh = typeof Refresh.Type

/** Styld, the stylist in the app: the chat open (none for a new one), the earlier chats, and what is being written. */
export const Model = Schema.Struct({
  chats: ChatsData.schema,
  open: Schema.Option(Chat),
  opening: Opening,
  draft: Schema.String,
  sending: Sending,
  refresh: Refresh,
  /** Reads of the chat since its reply's attempt ended, while the chat still shows it being written. */
  settling: Schema.Int,
  /** Times in a row the reply's live words were lost; each loss reads the chat and listens again. */
  misses: Misses,
  /** The try-ons the chat's replies name, read with the person's session. */
  tryOnCards: StylistTryOns.Model,
})
export type Model = typeof Model.Type

export const init = (draft: Option.Option<string>): Model => ({
  chats: AsyncData.Idle(),
  open: Option.none(),
  opening: Opening.None(),
  draft: Option.getOrElse(draft, () => ''),
  sending: Sending.Idle(),
  refresh: Refresh.Idle(),
  settling: 0,
  misses: 0,
  tryOnCards: StylistTryOns.init(),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadChats: { chats: Schema.Array(ChatSummary) },
  FailedLoadChats: {},
  SucceededLoadChat: { chat: Chat },
  FailedLoadChat: { chatId: Schema.String },
  SucceededRefreshChat: { chat: Chat },
  FailedRefreshChat: { chatId: Schema.String },
  ReceivedLiveDraft: { chatId: Schema.String, text: Schema.String },
  EndedLiveReply: { chatId: Schema.String },
  LostLiveReply: { chatId: Schema.String },
  UpdatedDraft: { value: Schema.String },
  SubmittedMessage: { locale: Language },
  ClickedStarter: { text: Schema.String, locale: Language },
  SucceededSend: { chatId: ChatId },
  FailedSend: { problem: SendProblem, operationId: Schema.Option(OperationId) },
  ClickedNewChat: {},
  ClickedChat: { chatId: Schema.String },
  ClickedRetryLoad: {},
  CompletedScrollToLatest: {},
  CompletedStartAtTop: {},
  CompletedFocusThread: {},
  GotTryOnCardsMessage: { message: StylistTryOns.Message },
})
export type Message = typeof Message.Type

// COMMAND

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

export const LoadChat = Command.define('LoadChat', {
  args: { chatId: Schema.String },
  messages: [Message.SucceededLoadChat, Message.FailedLoadChat],
  execute: ({ chatId }) =>
    readChat(chatId).pipe(
      Effect.map((chat) => Message.SucceededLoadChat({ chat })),
      Effect.orElseSucceed(() => Message.FailedLoadChat({ chatId })),
    ),
})

/** The chat again, after `pause` milliseconds: once its reply's attempt ended, or its live words were lost.
 */
export const RefreshChat = Command.define('RefreshChat', {
  args: { chatId: Schema.String, pause: Schema.Int },
  messages: [Message.SucceededRefreshChat, Message.FailedRefreshChat],
  execute: ({ chatId, pause }) =>
    Effect.andThen(Effect.sleep(Duration.millis(pause)), readChat(chatId)).pipe(
      Effect.map((chat) => Message.SucceededRefreshChat({ chat })),
      Effect.orElseSucceed(() => Message.FailedRefreshChat({ chatId })),
    ),
})

const refused = (problem: SendProblem) => () =>
  Effect.succeed(Message.FailedSend({ problem, operationId: Option.none() }))

/** Send the message to Styld, in the chat open or a new one, under a new operation id or the one a lost send had.
 */
export const SendMessage = Command.define('SendMessage', {
  args: {
    operationId: Schema.Option(OperationId),
    chatId: Schema.Option(Schema.String),
    text: Schema.String,
    locale: Language,
  },
  messages: [Message.SucceededSend, Message.FailedSend],
  execute: ({ operationId, chatId, text, locale }) =>
    Effect.gen(function* () {
      const drawn = yield* drawOperationId(operationId)
      const sent = Effect.gen(function* () {
        const api = yield* (yield* StyldClient).api
        const { chatId: sentTo } = yield* api.stylist.send({
          payload: {
            operationId: drawn,
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
          LimitReached: refused('dailyLimit'),
          Unavailable: refused('unavailable'),
          NotFound: refused('unavailable'),
        }),
        Effect.orElseSucceed(() => Message.FailedSend({ problem: 'network', operationId: Option.some(drawn) })),
      )
    }).pipe(Effect.orElseSucceed(() => Message.FailedSend({ problem: 'network', operationId: Option.none() }))),
})

/** The Commands that open the page. */
export const load = () => [LoadChats()]

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient | SecureRandom.SecureRandom>

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
 */
export const ScrollToLatest = Command.define('ScrollToLatest', {
  messages: [Message.CompletedScrollToLatest],
  execute: Dom.scrollIntoViewAfterPaint(`#${latestId}`, { block: 'end' }).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedScrollToLatest()),
  ),
})

/** A new chat starts at the top of the page with its title focused, as a page opened from the navigation does
 * (Navigation.ts): New chat removes itself, and the chat it leaves may have been scrolled far down.
 */
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
 */
export const FocusThread = Command.define('FocusThread', {
  messages: [Message.CompletedFocusThread],
  execute: Dom.focus(`#${threadId}`, { preventScroll: true, makeFocusable: true }).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusThread()),
  ),
})

/** The chat's try-on cards, as a child of the page. */
const tryOnCards = {
  read: (model: Model) => Option.some(model.tryOnCards),
  write: (model: Model, cards: StylistTryOns.Model) => modifyFields(model, { tryOnCards: () => cards }),
  toParentMessage: (message: StylistTryOns.Message) => Message.GotTryOnCardsMessage({ message }),
}

/** A chat read: shown when it is still the one open, with the try-ons its replies name read. While its reply is
 * written its live words follow it. */
const showChat = (model: Model, chat: Chat): UpdateReturn =>
  Option.exists(model.open, ({ id }) => id === chat.id)
    ? Update.foldChildStep({
        update: (cards: StylistTryOns.Model) => StylistTryOns.follow(cards, chat),
        ...tryOnCards,
      })(modifyFields(model, { open: () => Option.some(chat) }))
    : { model }

/** The open chat whose reply Styld is writing, which the page reads again. */
const writingChatId = (model: Model): Option.Option<string> =>
  Option.flatMap(model.open, (chat) => (chat.replying?.state === 'writing' ? Option.some(chat.id) : Option.none()))

/** Read the chat being written again after `pause`, unless a read is already on its way. */
const refreshReply = (model: Model, pause = 0): UpdateReturn =>
  Option.match(writingChatId(model), {
    onNone: () => ({ model }),
    onSome: (chatId) =>
      Refresh.guards.Reading(model.refresh)
        ? { model }
        : {
            model: modifyFields(model, { refresh: () => Refresh.Reading() }),
            commands: [RefreshChat({ chatId, pause })],
          },
  })

/** How long to wait before reading a chat again whose reply's attempt ended but which still shows it being written. */
const settlePause = 500
/** Reads of such a chat before the page stops waiting and offers Try again. */
const mostSettlingReads = 8

/** The open chat's reply being written, with its live words so far. */
const withDraft = (model: Model, chatId: string, text: string): Model =>
  modifyFields(model, {
    open: Option.map((chat) =>
      chat.id === chatId && chat.replying?.state === 'writing'
        ? { ...chat, replying: { ...chat.replying, text } }
        : chat,
    ),
    misses: () => 0,
  })

/** Following the reply being written: its live words as they come; when its attempt ends, the chat read until it
 * holds the reply; when the words are lost, the chat read and listened to again, up to five losses in a row. */
const liveUpdates = (model: Model) => ({
  ReceivedLiveDraft: ({ chatId, text }: { readonly chatId: string; readonly text: string }): UpdateReturn => ({
    model: withDraft(model, chatId, text),
  }),
  EndedLiveReply: (): UpdateReturn => refreshReply(modifyFields(model, { settling: () => 1 })),
  LostLiveReply: (): UpdateReturn => refreshReply(modifyFields(model, { misses: Number.increment })),
  SucceededRefreshChat: ({ chat }: { readonly chat: Chat }): UpdateReturn => {
    const before = Option.match(model.open, { onNone: () => 0, onSome: ({ messages }) => messages.length })
    const stillWriting = chat.replying?.state === 'writing'
    const settling = stillWriting && model.settling > 0 && model.settling < mostSettlingReads
    const shown = showChat(
      modifyFields(model, {
        refresh: () => Refresh.Idle(),
        settling: (reads) => (settling ? reads + 1 : stillWriting && reads > 0 ? mostSettlingReads : 0),
      }),
      chat,
    )
    if (settling) return refreshReply(shown.model, settlePause)
    return chat.messages.length > before && Option.exists(model.open, ({ id }) => id === chat.id)
      ? { ...shown, commands: [ScrollToLatest()] }
      : shown
  },
  // A failed read keeps the chat shown and counts as a loss: the live words are listened to again.
  FailedRefreshChat: ({ chatId }: { readonly chatId: string }): UpdateReturn => ({
    model: modifyFields(model, {
      refresh: () => Refresh.Idle(),
      misses: (misses) => (Option.exists(model.open, ({ id }) => id === chatId) ? Number.increment(misses) : misses),
    }),
  }),
})

/** Send what is written: a message lost on the network goes again as the same one. */
const submit = (model: Model, locale: Language, fromStarter = false): UpdateReturn => {
  if (!canSend(model)) return { model }
  return {
    model: modifyFields(model, { sending: () => Sending.Sending({ fromStarter }) }),
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
    misses: () => 0,
  }),
  commands: [LoadChat({ chatId })],
})

/** The message is in: the chat is read with it, and the list for its title. A message typed keeps focus in the
 * field; one a starter sent moves it to the thread once it opens. */
const sent = (model: Model, chatId: string): UpdateReturn => {
  const fromStarter = Sending.guards.Sending(model.sending) && model.sending.fromStarter
  const opened = openChat(modifyFields(model, { draft: () => '', sending: () => Sending.Idle() }), chatId, fromStarter)
  return { model: opened.model, commands: [...(opened.commands ?? []), LoadChats()] }
}

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
      return { ...shown, commands: [ScrollToLatest(), ...(pressed ? [FocusThread()] : [])] }
    },
    FailedLoadChat: ({ chatId }) =>
      isReading(model, chatId)
        ? { model: modifyFields(model, { opening: () => Opening.Failed({ chatId }) }) }
        : { model },
    ...liveUpdates(model),
    CompletedScrollToLatest: () => ({ model }),
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
        : submit(modifyFields(model, { draft: () => text, sending: () => Sending.Idle() }), locale, true),
    SucceededSend: ({ chatId }) => sent(model, chatId),
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
    GotTryOnCardsMessage: (got) =>
      Update.foldChild({ update: StylistTryOns.update, ...tryOnCards })(model, got.message),
    ClickedChat: ({ chatId }) => openChat(model, chatId, true),
    // Try again: the chat that did not open, the reply that stopped being followed, or the list of chats.
    ClickedRetryLoad: () => {
      if (Opening.guards.Failed(model.opening)) return openChat(model, model.opening.chatId, true)
      if (hasStopped(model.misses) || model.settling >= mostSettlingReads)
        return refreshReply(modifyFields(model, { misses: () => 0, settling: () => 0 }))
      return { model, commands: [LoadChats()] }
    },
  })

// SUBSCRIPTION

/** The reply being written: its chat, the Thread its live words name, and the losses so far (each loss listens
 * again, a moment later). Nothing while no reply is being written or after too many losses. */
const Following = { chatId: Schema.String, thread: Schema.String, misses: Misses }

/** The chat's live words while its reply is written, decoded by a module loaded only then (`StylistLive.ts`). */
const liveReply = ({
  chatId,
  thread,
  misses,
}: {
  readonly chatId: string
  readonly thread: string
  readonly misses: Misses
}) =>
  chatId === ''
    ? Stream.empty
    : Stream.unwrap(
        Effect.gen(function* () {
          // A moment later after each loss.
          yield* Effect.sleep(Duration.seconds(misses))
          const { followLive } = yield* Effect.tryPromise(() => import('./StylistLive.ts'))
          const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
          const response = yield* http.get(
            new URL(`/api/stylist/chats/${chatId}/live`, window.location.origin).toString(),
          )
          return followLive(thread, response.stream).pipe(
            Stream.map((draft) =>
              draft.ended
                ? Message.EndedLiveReply({ chatId })
                : Message.ReceivedLiveDraft({ chatId, text: draft.text }),
            ),
          )
        }),
      ).pipe(Stream.catch(() => Stream.make(Message.LostLiveReply({ chatId }))))

/** The open chat's reply, followed live while it is written: no polling. */
const replySubscriptions = Subscription.make<Model, Message, HttpClient.HttpClient>()((entry) => ({
  liveReply: entry(Following, {
    modelToDependencies: (model) =>
      Option.match(
        Option.filter(model.open, (chat) => chat.replying?.state === 'writing' && !hasStopped(model.misses)),
        {
          onNone: () => ({ chatId: '', thread: '', misses: 0 }),
          onSome: (chat) => ({ chatId: chat.id, thread: chat.thread, misses: model.misses }),
        },
      ),
    dependenciesToStream: liveReply,
  }),
}))

/** The reply followed live, and the chat's try-ons read again while one is being drawn. */
export const subscriptions = Subscription.aggregate(
  replySubscriptions,
  Subscription.lift(StylistTryOns.subscriptions)<Model, Message>(tryOnCards),
)
