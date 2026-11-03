import { Chat, ChatSummary, OperationId } from '@styld/protocol'
import { Array, Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  canSend,
  FocusThread,
  init,
  LoadChat,
  LoadChats,
  Message,
  type Model,
  Opening,
  RefreshChat,
  ScrollToLatest,
  SendMessage,
  Sending,
  StartAtTop,
  subscriptions,
  update,
} from '../src/page/Stylist.ts'

const chatId = `ch_${'tee'.padEnd(22, 'x')}`
const olderId = `ch_${'old'.padEnd(22, 'x')}`
const pieceId = `pc_${'tee'.padEnd(22, 'x')}`
const operationId = OperationId.make('7f9c2ba4-e88f-4f2a-9d1c-3b6e5a0d4c21')

const asked = { id: 'm1', role: 'person', text: 'What should I wear today?', parts: [], at: '2026-10-31T09:00:00.000Z' }
const chat = (replying?: { state: 'writing' | 'failed'; text: string }, answered = false) =>
  Schema.decodeUnknownSync(Chat)({
    id: chatId,
    title: 'What should I wear today?',
    thread: `acct--${chatId}`,
    messages: answered
      ? [
          asked,
          {
            id: 'm2',
            role: 'styld',
            text: 'Wear your white tee today.',
            parts: [{ _tag: 'Pieces', pieceIds: [pieceId] }],
            at: '2026-10-31T09:00:09.000Z',
          },
        ]
      : [asked],
    ...(replying === undefined ? {} : { replying: { ...replying, parts: [] } }),
  })
const summary = (id: string) =>
  Schema.decodeUnknownSync(ChatSummary)({ id, title: 'Earlier', updatedAt: '2026-10-30T18:00:00.000Z' })

/** The chat whose live words the page listens to, if any. */
const pending = (current: Model) =>
  Array.filter([subscriptions.liveReply.modelToDependencies(current).chatId], (id) => id !== '')

/** The page with a chat open whose reply Styld is writing. */
const writingChat = (): Model =>
  update(
    update(init(Option.none()), Message.ClickedChat({ chatId })).model,
    Message.SucceededLoadChat({ chat: chat({ state: 'writing', text: 'Wear your' }) }),
  ).model

describe('Styld, the stylist in the app', () => {
  test('a starter opens a chat, the reply is followed while it is written, and stops once it is in', () => {
    story(
      update,
      given(init(Option.none())),
      message(Message.SucceededLoadChats({ chats: [] })),
      model((current) => expect(current.open).toEqual(Option.none())),
      message(Message.ClickedStarter({ text: 'What should I wear today?', locale: 'en' })),
      Command.expectExact(
        SendMessage({
          operationId: Option.none(),
          chatId: Option.none(),
          text: 'What should I wear today?',
          locale: 'en',
        }),
      ),
      model((current) => {
        expect(canSend(current)).toBe(false)
        // A second starter tapped before the first is in sends nothing.
        const again = update(current, Message.ClickedStarter({ text: 'What is missing?', locale: 'en' }))
        expect(again.commands ?? []).toEqual([])
      }),
      Command.resolve(SendMessage, Message.SucceededSend({ chatId: chat().id })),
      model(({ draft, sending }) => {
        expect(draft).toBe('')
        expect(Sending.guards.Idle(sending)).toBe(true)
      }),
      Command.resolve(LoadChats, Message.SucceededLoadChats({ chats: [summary(chatId)] })),
      Command.resolve(LoadChat, Message.SucceededLoadChat({ chat: chat({ state: 'writing', text: 'Wear your' }) })),
      Command.resolve(ScrollToLatest, Message.CompletedScrollToLatest()),
      // The starter tapped is gone with the new chat: focus follows to the thread.
      Command.resolve(FocusThread, Message.CompletedFocusThread()),
      model((current) => {
        expect(Option.map(current.open, ({ replying }) => replying?.text)).toEqual(Option.some('Wear your'))
        expect(canSend({ ...current, draft: 'And tomorrow?' })).toBe(false)
      }),
      model((current) => expect(pending(current)).toEqual([chatId])),
      // The words arrive live, then the attempt ends and the chat is read with the reply in it.
      message(Message.ReceivedLiveDraft({ chatId, text: 'Wear your white' })),
      model((current) =>
        expect(Option.map(current.open, ({ replying }) => replying?.text)).toEqual(Option.some('Wear your white')),
      ),
      message(Message.EndedLiveReply({ chatId })),
      Command.expectExact(RefreshChat({ chatId, pause: 0 })),
      Command.resolve(RefreshChat, Message.SucceededRefreshChat({ chat: chat(undefined, true) })),
      Command.resolve(ScrollToLatest, Message.CompletedScrollToLatest()),
      Command.expectNone(),
      model((current) => {
        expect(Option.map(current.open, ({ messages }) => messages.length)).toEqual(Option.some(2))
        expect(canSend({ ...current, draft: 'And tomorrow?' })).toBe(true)
        expect(pending(current)).toEqual([])
      }),
    )
  })

  test('an ended attempt whose reply is not in the chat yet is read again a moment later, a few times at most', () => {
    const ended = update(writingChat(), Message.EndedLiveReply({ chatId }))
    expect(ended.commands?.map(({ name }) => name)).toEqual(['RefreshChat'])
    // A second end while the read is on its way asks for nothing more.
    expect(update(ended.model, Message.EndedLiveReply({ chatId })).commands ?? []).toEqual([])
    const stillWriting = update(
      ended.model,
      Message.SucceededRefreshChat({ chat: chat({ state: 'writing', text: 'W' }) }),
    )
    expect(stillWriting.commands?.map(({ name, args }) => [name, args])).toEqual([
      ['RefreshChat', { chatId, pause: 500 }],
    ])
    const exhausted = Array.reduce(
      Array.range(1, 8),
      stillWriting.model,
      (current) => update(current, Message.SucceededRefreshChat({ chat: chat({ state: 'writing', text: 'W' }) })).model,
    )
    expect(exhausted.settling).toBe(8)
    expect(update(exhausted, Message.ClickedRetryLoad()).commands?.map(({ name }) => name)).toEqual(['RefreshChat'])
  })

  test('after five lost live streams it stops listening, and Try again resumes', () => {
    const missed = Array.reduce(Array.range(1, 5), writingChat(), (current) => {
      const lost = update(current, Message.LostLiveReply({ chatId }))
      return update(lost.model, Message.SucceededRefreshChat({ chat: chat({ state: 'writing', text: 'W' }) })).model
    })
    expect(pending(missed)).toEqual([])
    const retried = update(missed, Message.ClickedRetryLoad())
    expect(retried.commands?.map(({ name }) => name)).toEqual(['RefreshChat'])
    expect(
      pending(
        update(retried.model, Message.SucceededRefreshChat({ chat: chat({ state: 'writing', text: 'W' }) })).model,
      ),
    ).toEqual([chatId])
  })

  test('the latest chat opens on arrival, unless the person came with something to ask', () => {
    story(
      update,
      given(init(Option.none())),
      message(Message.SucceededLoadChats({ chats: [summary(chatId), summary(olderId)] })),
      Command.expectExact(LoadChat({ chatId })),
      Command.resolve(LoadChat, Message.SucceededLoadChat({ chat: chat(undefined, true) })),
      Command.resolve(ScrollToLatest, Message.CompletedScrollToLatest()),
      model(({ open }) => expect(Option.map(open, ({ id }) => id)).toEqual(Option.some(chatId))),
    )
    story(
      update,
      given(init(Option.some('what goes with white'))),
      message(Message.SucceededLoadChats({ chats: [summary(chatId)] })),
      Command.expectNone(),
      model(({ open, draft }) => {
        expect(open).toEqual(Option.none())
        expect(draft).toBe('what goes with white')
      }),
    )
  })

  test('a message lost on the network goes again as the same one; a refused or rewritten one goes as a new one', () => {
    const tomorrow = (sentAs: Option.Option<OperationId>, text = ' And tomorrow? ') =>
      SendMessage({ operationId: sentAs, chatId: Option.some(chatId), text, locale: 'sl' })
    story(
      update,
      given({ ...init(Option.none()), open: Option.some(chat(undefined, true)) }),
      message(Message.UpdatedDraft({ value: ' And tomorrow? ' })),
      message(Message.SubmittedMessage({ locale: 'sl' })),
      Command.expectExact(tomorrow(Option.none())),
      Command.resolve(SendMessage, Message.FailedSend({ problem: 'network', operationId: Option.some(operationId) })),
      model(({ sending, draft }) => {
        expect(sending).toEqual(Sending.Failed({ problem: 'network', operationId: Option.some(operationId) }))
        expect(draft).toBe(' And tomorrow? ')
      }),
      message(Message.SubmittedMessage({ locale: 'sl' })),
      Command.expectExact(tomorrow(Option.some(operationId))),
      Command.resolve(SendMessage, Message.FailedSend({ problem: 'network', operationId: Option.some(operationId) })),
      message(Message.UpdatedDraft({ value: 'And on Sunday?' })),
      model(({ sending }) => expect(Sending.guards.Idle(sending)).toBe(true)),
      message(Message.SubmittedMessage({ locale: 'sl' })),
      Command.expectExact(tomorrow(Option.none(), 'And on Sunday?')),
      Command.resolve(SendMessage, Message.FailedSend({ problem: 'dailyLimit', operationId: Option.none() })),
      model(({ sending }) =>
        expect(sending).toEqual(Sending.Failed({ problem: 'dailyLimit', operationId: Option.none() })),
      ),
      message(Message.SubmittedMessage({ locale: 'sl' })),
      Command.expectExact(tomorrow(Option.none(), 'And on Sunday?')),
      Command.resolve(SendMessage, Message.SucceededSend({ chatId: chat().id })),
      Command.resolve(LoadChat, Message.SucceededLoadChat({ chat: chat({ state: 'failed', text: '' }) })),
      Command.resolve(ScrollToLatest, Message.CompletedScrollToLatest()),
      Command.resolve(LoadChats, Message.SucceededLoadChats({ chats: [summary(chatId)] })),
      Command.expectNone(),
    )
  })

  test('a new chat starts at the top of the page, its title focused', () => {
    const moved = update(init(Option.none()), Message.ClickedChat({ chatId })).model
    expect(update(moved, Message.ClickedNewChat()).commands?.map(({ name }) => name)).toEqual([StartAtTop.name])
  })

  test('a chat read after the person moved on, to a new chat, does not open', () => {
    const moved = update(init(Option.none()), Message.ClickedChat({ chatId })).model
    const started = update(moved, Message.ClickedNewChat()).model
    const late = update(started, Message.SucceededLoadChat({ chat: chat(undefined, true) }))
    expect(late.model.open).toEqual(Option.none())
    expect(late.commands ?? []).toEqual([])
  })

  test('a chat that does not open says so, and trying again opens it', () => {
    story(
      update,
      given(init(Option.none())),
      message(Message.ClickedChat({ chatId: chatId })),
      Command.resolve(LoadChat, Message.FailedLoadChat({ chatId: chatId })),
      model(({ opening }) => expect(opening).toEqual(Opening.Failed({ chatId }))),
      message(Message.ClickedRetryLoad()),
      Command.expectExact(LoadChat({ chatId: chatId })),
      model(({ opening }) => expect(opening).toEqual(Opening.Reading({ chatId, pressed: true }))),
      Command.resolve(LoadChat, Message.SucceededLoadChat({ chat: chat(undefined, true) })),
      Command.resolve(ScrollToLatest, Message.CompletedScrollToLatest()),
      // A chat the person chose takes focus once it is in, as the earlier chat pressed is gone.
      Command.resolve(FocusThread, Message.CompletedFocusThread()),
    )
  })
})
