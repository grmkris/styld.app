import { StylistQueue } from './Queue.ts'
import {
  ChatId,
  CurrentAccount,
  NotFound,
  type ChatMessage,
  ReplyPart,
  type SendChatMessage,
  StylistBusy,
  Unavailable,
  prices,
} from '@styld/protocol'
import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { LanguageModel } from 'effect/ai'
import { workersAiModel } from '../ai/LanguageModel.ts'
import { Holds, holdId } from '../usage/Holds.ts'
import type { Tool as AssistantTool } from '../mcp/Tools.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { maxSteps, styldModel } from './Policy.ts'
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

/** Each account's chats, in its Durable Object. */
export class ChatStores extends Context.Service<ChatStores, { readonly of: (accountId: string) => ChatStore }>()(
  '@styld/server/stylist/ChatStores',
) {
  static readonly layer = (of: (accountId: string) => ChatStore) => Layer.succeed(this, { of })
}

/** The assistants' own tools Styld answers with, each running for the account it is given. */
export class StylistTools extends Context.Service<
  StylistTools,
  { readonly forAccount: (accountId: string) => ReadonlyArray<AssistantTool<never>> }
>()('@styld/server/stylist/StylistTools') {}

/** What every Styld operation acts through, built once by the `StylistChats` layer. */
interface Deps {
  readonly chatsOf: (accountId: string) => ChatStore
  readonly queue: StylistQueue['Service']
  readonly model: LanguageModel.LanguageModel
  readonly tools: StylistTools['Service']
  readonly wardrobe: Wardrobe['Service']
  readonly holds: Holds['Service']
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
const giveUp = (deps: Deps, accountId: string, turnId: string) =>
  Effect.gen(function* () {
    yield* stored(
      deps
        .chatsOf(accountId)
        .finish({ turnId, outcome: 'failed', text: '', parts: '[]', messageId: '', now: yield* now }),
    )
    yield* deps.holds.settle(accountId, holdOf(turnId), 'failed')
  })

/** Write one reply: the model answers the chat so far with the account's tools, reporting what it has written. */
const reply = (
  deps: Deps,
  accountId: string,
  turnId: string,
  input: { readonly locale: string; readonly messages: ReadonlyArray<StoredMessage> },
) =>
  Effect.gen(function* () {
    const pieces = yield* deps.wardrobe
      .listPieces()
      .pipe(Effect.provideService(CurrentAccount, { accountId, via: 'assistant' }))
    const tools = yield* turnTools(
      deps.tools.forAccount(accountId),
      { turnId, pieceIds: new Set(pieces.map(({ id }) => id)) },
      Context.empty(),
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
          yield* deps.chatsOf(accountId).progress(turnId, sofar, shown).pipe(Effect.ignore)
        }),
    }).pipe(Effect.provideService(LanguageModel.LanguageModel, deps.model))
    return { text, parts: yield* tools.parts }
  })

/** Sending a message: the reply begun, then its credit held, then handed to the queue. The reply exists before its
 * hold, so whatever settles a reply (its delivery, giving it up) finds it; a credit that cannot be held takes the reply
 * back. A repeated request returns the same chat, holds the same credit (holding twice is once) and sends the reply to
 * the queue again: one lost on the way is made up, and the queue writes it once. */
const sending = (deps: Deps, ids: Ids) =>
  Effect.fn('Styld.Stylist.send')(function* (input: SendChatMessage) {
    const { accountId } = yield* CurrentAccount
    const turnId = yield* ids.turnIdOf(accountId, input.operationId)
    // The turn's queue delivery records the same job id, so the ask and its reply are found together.
    yield* Effect.annotateCurrentSpan('styld.job_id', turnId)
    const chats = deps.chatsOf(accountId)
    const begun = yield* stored(
      chats.begin({
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
    )
    if (begun.outcome === 'busy') return yield* StylistBusy.make({})
    if (begun.outcome === 'missing') return yield* NotFound.make({})
    yield* deps.holds
      .reserve({ accountId, hold: holdOf(turnId), credits: prices.stylistMessage })
      .pipe(Effect.tapError(() => Effect.ignore(stored(chats.withdraw(turnId)))))
    const queued = yield* Effect.tryPromise(() => deps.queue.send({ _tag: 'WriteReply', turnId, accountId })).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (queued || begun.outcome === 'replayed') return { chatId: ChatId.make(begun.chatId) }
    yield* giveUp(deps, accountId, turnId)
    return yield* unavailable()
  })

/** Reading the person's chats, the latest first, and one of them with the reply being written to it. */
const reading = (deps: Deps) => ({
  chats: Effect.fn('Styld.Stylist.chats')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored(deps.chatsOf(accountId).chats(listed))
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
    const found = yield* stored(deps.chatsOf(accountId).chat(chatId, yield* now, patience))
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
const queueing = (deps: Deps, ids: Ids) => ({
  /** A reply already ended only has its credit settled. */
  processTurn: Effect.fn('Styld.Stylist.processTurn')(function* (accountId: string, turnId: string) {
    const input = yield* stored(deps.chatsOf(accountId).turn(turnId))
    if (!input.found) return
    if (input.state !== 'writing')
      return yield* deps.holds.settle(accountId, holdOf(turnId), input.state === 'done' ? 'succeeded' : 'failed')
    const answered = yield* reply(deps, accountId, turnId, input).pipe(
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
      deps.chatsOf(accountId).finish({
        turnId,
        outcome: 'done',
        text: answered.text,
        parts: JSON.stringify(answered.parts),
        messageId: yield* ids.randomId('ms'),
        now: yield* now,
      }),
    )
    yield* deps.holds.settle(accountId, holdOf(turnId), 'succeeded')
  }),
  /** The queue's last attempt failed: the reply shows as failed and its credit comes back. */
  failTurn: Effect.fn('Styld.Stylist.failTurn')(function* (accountId: string, turnId: string) {
    yield* giveUp(deps, accountId, turnId)
  }),
  /** Forget every chat of an account being deleted. */
  erase: Effect.fn('Styld.Stylist.erase')(function* (accountId: string) {
    yield* stored(deps.chatsOf(accountId).erase())
  }),
})

const make = Effect.gen(function* () {
  const deps: Deps = {
    chatsOf: (yield* ChatStores).of,
    queue: yield* StylistQueue,
    model: yield* LanguageModel.LanguageModel,
    tools: yield* StylistTools,
    wardrobe: yield* Wardrobe,
    holds: yield* Holds,
  }
  return { send: sending(deps, replyIds), ...reading(deps), ...queueing(deps, replyIds) }
})

/** Styld, the stylist in the app: the person's messages and chats, and its replies written on the queue, with its
 * model on Workers AI. */
export class StylistChats extends Context.Service<StylistChats, Effect.Success<typeof make>>()(
  '@styld/server/stylist/StylistChats',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => StylistChats.of(service)),
  ).pipe(Layer.provide(workersAiModel(styldModel)))
}
