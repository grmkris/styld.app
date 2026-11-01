import { chatCost } from '../providers/Costs.ts'
import type { StylistTurn } from './Queue.ts'
import {
  ChatId,
  NotFound,
  type ChatMessage,
  ReplyPart,
  type SendChatMessage,
  StylistBusy,
  Unavailable,
  prices,
} from '@styld/protocol'
import { type Context, DateTime, Effect, Option, Schema } from 'effect'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import { type Holds, holdId } from '../usage/Holds.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { Tool as AssistantTool } from '../mcp/Tools.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { maxSteps } from './Policy.ts'
import type { StylistModel } from '../Providers.ts'
import { historyText, outlineOf, systemPrompt } from './Prompt.ts'
import type { StoredMessage, StylistMethods } from './StylistObject.ts'
import { lookingUpToolNames, showingToolNames, turnTools } from './Tools.ts'
import { runTurn } from './Turn.ts'
import { digestOf, newId } from '../kernel/Ids.ts'

/** How long a reply may be written before it shows as failed and another message may begin: longer than the queue's
 * attempts at it. */
const patience = 5 * 60_000

/** Chats a list shows. */
const listed = 30

const unavailable = () => Unavailable.make({})

/** A failure's kind for the logs: its name, such as TimeoutError or AiError, never its message. */
const failureOf = (error: unknown) => (error instanceof Error ? error.name : typeof error).slice(0, 80)

const decodeParts = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(ReplyPart)))
/** A reply's parts as stored; none for any that do not read, which only an older shape could leave. */
const partsOf = (json: string): ReadonlyArray<ReplyPart> => Option.getOrElse(decodeParts(json), () => [])

/** A chat's title: its first message, cut at a word near 60 characters. */
export const titleOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= 60) return line
  const cut = line.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** One account's chats: its Durable Object's methods, callable from the Worker. */
export type ChatStore = {
  readonly [Method in keyof StylistMethods]: (
    ...args: Parameters<StylistMethods[Method]>
  ) => Effect.Effect<Effect.Success<ReturnType<StylistMethods[Method]>>, unknown>
}

export interface StylistParts<R> {
  readonly chatsOf: (accountId: string) => ChatStore
  readonly queue: { send(message: StylistTurn): Promise<unknown> }
  readonly model: StylistModel['Service']
  /** The assistants' tools, and what they need to run for an account. */
  readonly tools: ReadonlyArray<AssistantTool<R>>
  readonly toolContext: (accountId: string) => Context.Context<R>
  readonly wardrobe: Wardrobe['Service']
  readonly holds: Holds['Service']
  readonly metrics: CaptureMetrics['Service']
}

const now = Effect.map(DateTime.now, DateTime.toEpochMillis)
const holdOf = (turnId: string) => holdId('stylist', turnId, 0)
const stored = <A, E, RX>(effect: Effect.Effect<A, E, RX>) => Effect.mapError(effect, unavailable)

const messageOf = (message: StoredMessage): ChatMessage => ({
  id: message.id,
  role: message.role,
  text: message.text,
  parts: partsOf(message.parts),
  at: new Date(message.at).toISOString(),
})

/** Ids for chats and messages, and a reply's id from the account and the request's operation id: the same request
 * is the same reply. */
const replyIds = {
  randomId: (prefix: 'ch' | 'ms') => newId(prefix),
  turnIdOf: (accountId: string, operationId: string) =>
    Effect.map(digestOf(`${accountId}:${operationId}`), (digest) => `tn_${digest.slice(0, 22)}`),
}
type Ids = typeof replyIds

/** A reply that will not come: shown as failed, and its credit back. */
const giveUp = <R>(parts: StylistParts<R>, accountId: string, turnId: string) =>
  Effect.gen(function* () {
    yield* stored(
      parts
        .chatsOf(accountId)
        .finish({ turnId, outcome: 'failed', text: '', parts: '[]', messageId: '', now: yield* now }),
    )
    yield* parts.holds.settle(accountId, holdOf(turnId), 'failed')
  })

/** Write one reply: the model answers the chat so far with the account's tools, reporting what it has written. */
const reply = <R>(
  parts: StylistParts<R>,
  accountId: string,
  turnId: string,
  input: { readonly locale: string; readonly messages: ReadonlyArray<StoredMessage> },
) =>
  Effect.gen(function* () {
    const pieces = yield* parts.wardrobe
      .listPieces()
      .pipe(Effect.provideService(CurrentAccount, { accountId, via: 'assistant' }))
    const tools = yield* turnTools(
      parts.tools,
      { turnId, pieceIds: new Set(pieces.map(({ id }) => id)) },
      parts.toolContext(accountId),
    )
    const today = DateTime.formatIsoDateUtc(yield* DateTime.now)
    const text = yield* runTurn({
      system: systemPrompt({ locale: input.locale === 'sl' ? 'sl' : 'en', today, outline: outlineOf(pieces) }),
      history: input.messages.map((message) => ({
        role: message.role,
        text: historyText({ role: message.role, text: message.text, parts: partsOf(message.parts) }),
      })),
      toolkit: yield* tools.toolkit.pipe(Effect.provide(tools.handlers)),
      maxSteps,
      showing: showingToolNames,
      lookingUp: lookingUpToolNames,
      progress: (sofar) =>
        Effect.gen(function* () {
          const shown = JSON.stringify(yield* tools.parts)
          yield* parts.chatsOf(accountId).progress(turnId, sofar, shown).pipe(Effect.ignore)
        }),
      counted: (usage) =>
        parts.metrics.call({
          provider: 'workers-ai',
          model: parts.model.model,
          kind: 'chat',
          outcome: usage.answered ? 'ok' : 'failed',
          milliseconds: usage.milliseconds,
          units: usage.inputTokens + usage.outputTokens,
          costMicroUsd: chatCost(parts.model.model, usage.inputTokens, usage.outputTokens),
        }),
    }).pipe(Effect.provide(parts.model.layer))
    return { text, parts: yield* tools.parts }
  })

/** Sending a message: its credit held, the reply begun and handed to the queue. A repeated request returns the same
 * chat, and sends the reply to the queue again: one lost on the way is made up, and the queue writes it once. */
const sending = <R>(parts: StylistParts<R>, ids: Ids) =>
  Effect.fn('Styld.Stylist.send')(function* (input: SendChatMessage) {
    const { accountId } = yield* CurrentAccount
    const turnId = yield* ids.turnIdOf(accountId, input.operationId)
    // The turn's queue delivery records the same job id, so the ask and its reply are found together.
    yield* Effect.annotateCurrentSpan('styld.job_id', turnId)
    yield* parts.holds.reserve({ accountId, hold: holdOf(turnId), credits: prices.stylistMessage })
    const refund = parts.holds.settle(accountId, holdOf(turnId), 'failed')
    const begun = yield* stored(
      parts.chatsOf(accountId).begin({
        turnId,
        chatId: input.chatId ?? (yield* ids.randomId('ch')),
        newChat: input.chatId === undefined,
        text: input.text,
        title: titleOf(input.text),
        locale: input.locale,
        messageId: yield* ids.randomId('ms'),
        now: yield* now,
        patience,
      }),
    ).pipe(Effect.tapError(() => Effect.ignore(refund)))
    if (begun.outcome === 'busy' || begun.outcome === 'missing') {
      yield* refund
      return yield* begun.outcome === 'busy' ? StylistBusy.make({}) : NotFound.make({})
    }
    const queued = yield* Effect.tryPromise(() => parts.queue.send({ _tag: 'WriteReply', turnId, accountId })).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (queued || begun.outcome === 'replayed') return { chatId: ChatId.make(begun.chatId) }
    yield* giveUp(parts, accountId, turnId)
    return yield* unavailable()
  })

/** Reading the person's chats, the latest first, and one of them with the reply being written to it. */
const reading = <R>(parts: StylistParts<R>) => ({
  chats: Effect.fn('Styld.Stylist.chats')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored(parts.chatsOf(accountId).chats(listed))
    return {
      chats: rows.map((row) => ({
        id: ChatId.make(row.id),
        title: row.title,
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    }
  }),
  chat: Effect.fn('Styld.Stylist.chat')(function* (chatId: ChatId) {
    const { accountId } = yield* CurrentAccount
    const found = yield* stored(parts.chatsOf(accountId).chat(chatId, yield* now, patience))
    if (found === undefined) return yield* NotFound.make({})
    const { replying } = found
    return {
      id: chatId,
      title: found.title,
      messages: found.messages.map(messageOf),
      ...(replying === undefined
        ? {}
        : { replying: { state: replying.state, text: replying.text, parts: partsOf(replying.parts) } }),
    }
  }),
})

/** The queue's side: write a reply once, give one up, and forget an account's chats. */
const queueing = <R>(parts: StylistParts<R>, ids: Ids) => ({
  /** A reply already ended only has its credit settled. */
  processTurn: Effect.fn('Styld.Stylist.processTurn')(function* (accountId: string, turnId: string) {
    const input = yield* stored(parts.chatsOf(accountId).turn(turnId))
    if (!input.found) return
    if (input.state !== 'writing')
      return yield* parts.holds.settle(accountId, holdOf(turnId), input.state === 'done' ? 'succeeded' : 'failed')
    const answered = yield* reply(parts, accountId, turnId, input).pipe(
      // What failed, by its kind alone (a call past its patience, the model's error), never its words.
      Effect.tapError((error) =>
        Effect.logWarning('Styld.Stylist model failed').pipe(
          Effect.annotateLogs({ 'styld.stylist.failure': failureOf(error) }),
        ),
      ),
      Effect.mapError(unavailable),
    )
    // A model that wrote nothing and showed nothing has not answered: the queue asks again.
    if (answered.text.length === 0 && answered.parts.length === 0) return yield* unavailable()
    yield* stored(
      parts.chatsOf(accountId).finish({
        turnId,
        outcome: 'done',
        text: answered.text,
        parts: JSON.stringify(answered.parts),
        messageId: yield* ids.randomId('ms'),
        now: yield* now,
      }),
    )
    yield* parts.holds.settle(accountId, holdOf(turnId), 'succeeded')
  }),
  /** The queue's last attempt failed: the reply shows as failed and its credit comes back. */
  failTurn: Effect.fn('Styld.Stylist.failTurn')(function* (accountId: string, turnId: string) {
    yield* giveUp(parts, accountId, turnId)
  }),
  /** Forget every chat of an account being deleted. */
  erase: Effect.fn('Styld.Stylist.erase')(function* (accountId: string) {
    yield* stored(parts.chatsOf(accountId).erase())
  }),
})

/** Styld, the stylist in the app: the person's messages and chats, and its replies written on the queue. */
export const makeStylist = <R>(parts: StylistParts<R>) =>
  Effect.sync(() => ({ send: sending(parts, replyIds), ...reading(parts), ...queueing(parts, replyIds) }))

export type StylistService = Effect.Success<ReturnType<typeof makeStylist>>
