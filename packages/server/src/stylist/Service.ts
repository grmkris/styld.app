import { StylistQueue } from './Queue.ts'
import {
  ChatId,
  CurrentAccount,
  Day,
  NotFound,
  type ChatMessage,
  ReplyPart,
  type SendChatMessage,
  StylistBusy,
  prices,
} from '@styld/protocol'
import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { LanguageModel } from 'effect/ai'
import { providerErrorOf, textModel } from '../ai/LanguageModel.ts'
import { Holds } from '../usage/Holds.ts'
import { PaidAttempts } from '../usage/Attempts.ts'
import type { Tool as AssistantTool } from '../mcp/Tools.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { analysisDays, maxSteps, styldModel } from './Policy.ts'
import { analysisOf } from './Analysis.ts'
import { Worn } from '../worn/Worn.ts'
import { historyMessages, languageOf, outlineOf, systemPrompt } from './Prompt.ts'
import { finishedReply, readableReply } from './Reply.ts'
import type { StoredMessage } from './StylistObject.ts'
import { ChatStores, chatsOf, giveUp, holdOf, now, settled, stored, sweepTurn, unavailable } from './Chats.ts'
import { StylistTurns } from './Store.ts'
import { lookingUpToolNames, showingToolNames, turnTools } from './Tools.ts'
import { runTurn } from './Turn.ts'
import { nowDate } from '../kernel/Db.ts'
import { digestOf, newId } from '../kernel/Ids.ts'

/** How long a reply may be written before it shows as failed and another message may begin: longer than the queue's
 * attempts at it. */
const patience = 5 * 60_000

/** Chats a list shows. */
const listed = 30

/** A failure's kind for the logs: its name, such as TimeoutError or AiError, never its message. */
const failureOf = (error: unknown) => (error instanceof Error ? error.name : typeof error).slice(0, 80)

const decodeParts = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(ReplyPart)))
/** A reply's parts as stored. Only the service writes them, through the same schema; parts that do not decode are a
 * bug. */
const partsOf = (json: string) => decodeParts(json).pipe(Effect.orDie)

/** A written reply as a delivery keeps it until it is in the chat, so a retry finishes it without asking again. */
const Written = Schema.Struct({ text: Schema.String, parts: Schema.Array(ReplyPart) })

/** A chat's title: its first message, cut at a word near 60 characters. */
const titleOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= 60) return line
  const cut = line.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The assistants' own tools Styld answers with, each running for the account it is given. */
export class StylistTools extends Context.Service<
  StylistTools,
  { readonly forAccount: (accountId: string) => ReadonlyArray<AssistantTool<never>> }
>()('@styld/server/stylist/StylistTools') {}

/** The services every Styld operation acts through, provided once by the `StylistChats` layer. */
type StylistServices =
  | ChatStores
  | StylistTurns
  | StylistQueue
  | LanguageModel.LanguageModel
  | StylistTools
  | Wardrobe
  | Worn
  | Holds
  | PaidAttempts

const messageOf = (message: StoredMessage) =>
  Effect.map(partsOf(message.parts), (parts): ChatMessage => ({
    id: message.id,
    role: message.role,
    text: message.text,
    parts,
    at: new Date(message.at).toISOString(),
  }))

/** Ids for chats and messages, and a reply's id from the account and the request's operation id: the same request
 * is the same reply. */
const replyIds = {
  randomId: (prefix: 'ch' | 'ms') => newId(prefix),
  turnIdOf: (accountId: string, operationId: string) =>
    Effect.map(digestOf(`${accountId}:${operationId}`), (digest) => `tn_${digest.slice(0, 22)}`),
}

/** Write one reply: the model answers the chat so far with the account's tools, reporting what it has written, in the
 * language of the person's latest message (the app's where its words do not tell). What the person reads is made
 * readable and checked against their pieces (`Reply.ts`). */
const reply = (
  accountId: string,
  turnId: string,
  input: { readonly locale: string; readonly messages: ReadonlyArray<StoredMessage> },
) =>
  Effect.gen(function* () {
    const chats = yield* chatsOf(accountId)
    const pieces = yield* (yield* Wardrobe)
      .listPieces()
      .pipe(Effect.provideService(CurrentAccount, { accountId, via: 'assistant' }))
    const own = new Set<string>(pieces.map(({ id }) => id))
    const moment = yield* DateTime.now
    const today = DateTime.formatIsoDateUtc(moment)
    const worn = yield* Worn
    const analyze = Effect.gen(function* () {
      const from = Day.make(DateTime.formatIsoDateUtc(DateTime.subtract(moment, { days: analysisDays })))
      const wornDays = yield* worn.listWorn({ from, to: Day.make(today) })
      const analysis = analysisOf(pieces, {
        days: analysisDays,
        pieceIds: wornDays.flatMap(({ pieceIds }) => pieceIds),
      })
      const names = new Map<string, string>(pieces.map(({ id, name, type }) => [id, name ?? type]))
      // The model reads the most worn pieces by name; their ids stay in the card.
      const most = analysis.worn.most.map(({ pieceId, days }) => ({ piece: names.get(pieceId) ?? '', days }))
      return { analysis, told: { ...analysis, worn: { ...analysis.worn, most } } }
    }).pipe(Effect.provideService(CurrentAccount, { accountId, via: 'assistant' }))
    const tools = yield* turnTools(
      (yield* StylistTools).forAccount(accountId),
      { turnId, pieceIds: own, analyze },
      Context.empty(),
    )
    const latest = input.messages.findLast(({ role }) => role === 'person')?.text ?? ''
    const language = languageOf(latest, input.locale === 'sl' ? 'sl' : 'en')
    const written = yield* runTurn({
      system: systemPrompt({ language, today, outline: outlineOf(pieces) }),
      history: (yield* Effect.forEach(input.messages, (message, index) =>
        Effect.map(partsOf(message.parts), (parts) => historyMessages({ ...message, parts }, index)),
      )).flat(),
      toolkit: yield* tools.toolkit.pipe(Effect.provide(tools.handlers)),
      maxSteps,
      showing: showingToolNames,
      lookingUp: lookingUpToolNames,
      progress: (sofar) =>
        Effect.gen(function* () {
          const shown = JSON.stringify(yield* tools.parts)
          yield* chats.progress(turnId, readableReply(sofar), shown).pipe(Effect.ignore)
        }),
    })
    return finishedReply(written, yield* tools.parts, own)
  })

/** Sending a message: the reply begun, then opened in D1, then its credit held, then handed to the queue. The reply
 * and its open row exist before its hold, so whatever settles a reply (its delivery, giving it up, the sweep) finds it;
 * a row that cannot be written or a credit that cannot be held takes the reply back. A repeated request returns the same chat, holds the same credit (holding twice is once) and sends the reply to
 * the queue again: one lost on the way is made up, and the queue writes it once. */
const send = Effect.fn('Styld.Stylist.send')(function* (input: SendChatMessage) {
  const { accountId } = yield* CurrentAccount
  const turnId = yield* replyIds.turnIdOf(accountId, input.operationId)
  // The turn's queue delivery records the same job id, so the ask and its reply are found together.
  yield* Effect.annotateCurrentSpan('styld.job_id', turnId)
  const chats = yield* chatsOf(accountId)
  const begun = yield* stored(
    chats.begin({
      turnId,
      chatId: input.chatId ?? (yield* replyIds.randomId('ch')),
      newChat: input.chatId === undefined,
      text: input.text,
      title: titleOf(input.text),
      locale: input.locale,
      messageId: yield* replyIds.randomId('ms'),
      now: yield* now,
      patience,
    }),
  )
  if (begun.outcome === 'busy') return yield* StylistBusy.make({})
  if (begun.outcome === 'missing') return yield* NotFound.make({})
  const queue = yield* StylistQueue
  const withdraw = Effect.ignore(stored(chats.withdraw(turnId)))
  yield* stored((yield* StylistTurns).open(turnId, accountId, yield* nowDate)).pipe(Effect.tapError(() => withdraw))
  yield* (yield* Holds)
    .reserve({ accountId, hold: holdOf(turnId), credits: prices.stylistMessage })
    .pipe(Effect.tapError(() => withdraw))
  const queued = yield* Effect.tryPromise(() => queue.send({ _tag: 'WriteReply', turnId, accountId })).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )
  if (queued || begun.outcome === 'replayed') return { chatId: ChatId.make(begun.chatId) }
  yield* giveUp(accountId, turnId)
  return yield* unavailable()
})

/** Reading the person's chats, the latest first, and one of them with the reply being written to it. */
const reading = Effect.map(Effect.context<StylistServices>(), (context) => ({
  chats: Effect.fn('Styld.Stylist.chats')(function* () {
    const { accountId } = yield* CurrentAccount
    const rows = yield* stored((yield* chatsOf(accountId)).chats(listed))
    return {
      chats: rows.map((row) => ({
        id: ChatId.make(row.id),
        title: row.title,
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    }
  }, Effect.provide(context)),
  chat: Effect.fn('Styld.Stylist.chat')(function* (chatId: ChatId) {
    const { accountId } = yield* CurrentAccount
    const found = yield* stored((yield* chatsOf(accountId)).chat(chatId, yield* now, patience))
    if (found === undefined) return yield* NotFound.make({})
    const { replying } = found
    return {
      id: chatId,
      title: found.title,
      messages: yield* Effect.forEach(found.messages, messageOf),
      ...(replying === undefined
        ? {}
        : { replying: { state: replying.state, text: replying.text, parts: yield* partsOf(replying.parts) } }),
    }
  }, Effect.provide(context)),
}))

/** The queue's side: write a reply once, give one up, and forget an account's chats. */
const queueing = Effect.map(Effect.context<StylistServices>(), (context) => ({
  /** A reply already ended only has its credit settled. The reply is written once (`PaidAttempts`): a redelivery
   * finishes what the first wrote, leaves one being written to its delivery, and gives up one whose delivery died. */
  processTurn: Effect.fn('Styld.Stylist.processTurn')(function* (accountId: string, turnId: string) {
    const chats = yield* chatsOf(accountId)
    const input = yield* stored(chats.turn(turnId))
    if (!input.found) return
    if (input.state !== 'writing')
      return yield* settled(accountId, turnId, input.state === 'done' ? 'succeeded' : 'failed')
    const writing = reply(accountId, turnId, input).pipe(
      // What failed, by its kind alone (a call past its patience, the model's error), never its words.
      Effect.tapError((error) =>
        Effect.logWarning('Styld.Stylist model failed').pipe(
          Effect.annotateLogs({ 'styld.stylist.failure': failureOf(error) }),
        ),
      ),
      // Keep unknown paid outcomes visible to PaidAttempts, which must retain the claim rather than resubmit.
      Effect.catchTag('AiError', (error) => Effect.fail(providerErrorOf(error))),
      // A model that wrote nothing and showed nothing has not answered: the queue asks again.
      Effect.filterOrFail((answer) => answer.text.length > 0 || answer.parts.length > 0, unavailable),
    )
    const attempts = yield* PaidAttempts
    const work = { key: `stylist/${turnId}`, accountId, provider: 'litellm', result: Written }
    const answered = yield* attempts.run(work, writing).pipe(
      Effect.map(Option.some),
      Effect.catchTags({
        AttemptElsewhere: () => Effect.succeedNone,
        ProviderError: () => Effect.as(giveUp(accountId, turnId), Option.none()),
      }),
    )
    if (Option.isNone(answered)) return
    yield* stored(
      chats.finish({
        turnId,
        outcome: 'done',
        text: answered.value.text,
        parts: JSON.stringify(answered.value.parts),
        messageId: yield* replyIds.randomId('ms'),
        now: yield* now,
      }),
    )
    yield* settled(accountId, turnId, 'succeeded')
    // The reply is in the chat: D1 keeps none of its words.
    yield* attempts.forget(work.key).pipe(Effect.ignore)
  }, Effect.provide(context)),
  /** The queue's last attempt failed: the reply shows as failed and its credit comes back. */
  failTurn: Effect.fn('Styld.Stylist.failTurn')(function* (accountId: string, turnId: string) {
    yield* giveUp(accountId, turnId)
  }, Effect.provide(context)),
  /** The sweep: a turn still open past its patience is settled from its status (`Chats.ts` `sweepTurn`). */
  sweepTurn: (turnId: string) => sweepTurn(turnId).pipe(Effect.provide(context)),
  /** Forget every chat of an account being deleted. */
  erase: Effect.fn('Styld.Stylist.erase')(function* (accountId: string) {
    yield* stored((yield* chatsOf(accountId)).erase())
  }, Effect.provide(context)),
}))

/** Every Styld operation, each group built over the services it yields (`StylistServices`). */
const make = Effect.gen(function* () {
  const context = yield* Effect.context<StylistServices>()
  return {
    send: (input: SendChatMessage) => send(input).pipe(Effect.provide(context)),
    ...(yield* reading),
    ...(yield* queueing),
  }
})

/** Styld, the stylist in the app: the person's messages and chats, and its replies written on the queue, with its
 * model through its paid LiteLLM route. */
export class StylistChats extends Context.Service<StylistChats, Effect.Success<typeof make>>()(
  '@styld/server/stylist/StylistChats',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => StylistChats.of(service)),
  ).pipe(Layer.provide([textModel(styldModel), StylistTurns.layer]))
}
