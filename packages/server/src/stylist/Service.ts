import { ChatId, CurrentAccount, Day, NotFound, type SendChatMessage, Unavailable, prices } from '@styld/protocol'
import { Context, DateTime, Effect, Layer, Option, type Stream } from 'effect'
import { digestOf } from '../kernel/Ids.ts'
import { nowDate, stored } from '../kernel/Db.ts'
import type { Tool as AssistantTool } from '../mcp/Tools.ts'
import { type Ending, Holds, holdId } from '../usage/Holds.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { Worn } from '../worn/Worn.ts'
import { Tastes } from '../taste/Taste.ts'
import { accountOfThread, type Settled, threadIdOf, type ToolRequest } from './Agent.ts'
import { analysisOf } from './Analysis.ts'
import { ChatIndex } from './Index.ts'
import { analysisDays } from './Policy.ts'
import { languageOf, outlineOf } from './Prompt.ts'
import { StylistThreads } from './Threads.ts'
import { runTool } from './Tools.ts'

// Styld, the stylist in the app (owner, 2026-10-31), on Yielded Agent (3 November 2026): each chat is a Thread that
// writes its replies and keeps its messages (`Thread.ts`); D1 lists each account's chats (`Index.ts`). Sending a
// message holds its credit, then admits it to the chat's Thread; the Thread's outbox settles the credit once when the
// reply ends (`settle`). A message whose admission never happened is refunded by the settlements sweep.

/** Chats a list shows. */
const listed = 30

/** A chat's title: its first message, cut at a word near 60 characters. */
const titleOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= 60) return line
  const cut = line.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** A message's credit in the Wallet: one per message, named by the account and the operation it was sent with, so
 * the API Worker that holds it and the Thread's outbox that settles it name the same hold. */
const turnIdOf = (accountId: string, operationId: string) =>
  Effect.map(digestOf(`${accountId}:${operationId}`), (digest) => `tn_${digest.slice(0, 22)}`)

/** A message's hold: one per message, its first and only attempt. */
const holdOf = (turnId: string) => holdId('stylist', turnId, 0)

/** A new chat's id, from the message that starts it: a repeated request starts the same chat. */
const newChatIdOf = (accountId: string, operationId: string) =>
  Effect.map(digestOf(`chat:${accountId}:${operationId}`), (digest) => ChatId.make(`ch_${digest.slice(0, 22)}`))

/** How a reply's ending settles its credit: only a reply that came is paid for. */
const endingOf = (outcome: Settled['outcome']): Ending =>
  outcome === 'completed' ? 'succeeded' : outcome === 'unknown' ? 'unknown' : 'failed'

/** The assistants' own tools Styld answers with, each running for the account it is given. */
export class StylistTools extends Context.Service<
  StylistTools,
  { readonly forAccount: (accountId: string) => ReadonlyArray<AssistantTool<never>> }
>()('@styld/server/stylist/StylistTools') {}

/** An operation for an account, as an assistant acts for it. */
const asAccount = (accountId: string) => Effect.provideService(CurrentAccount, { accountId, via: 'assistant' as const })

/** What Styld knows about the person, for a reply: left out when it cannot be read just now, so a chat never waits on
 * it. */
const aboutOf = (tastes: Tastes['Service'], accountId: string) =>
  tastes.getTaste().pipe(
    asAccount(accountId),
    Effect.map(({ showMe, occasions, notes, learned }) => ({
      showMe,
      occasions,
      notes: notes.map(({ text }) => text),
      learned,
    })),
    Effect.option,
  )

/** What a reply is told besides the message: its language (the person's words, else the app's), today, the wardrobe in
 * a line and what Styld knows about the person. */
const inputFor =
  (wardrobe: Wardrobe['Service'], tastes: Tastes['Service']) => (accountId: string, input: SendChatMessage) =>
    Effect.gen(function* () {
      const pieces = yield* wardrobe.listPieces().pipe(
        asAccount(accountId),
        Effect.mapError(() => Unavailable.make({})),
      )
      const about = yield* aboutOf(tastes, accountId)
      return {
        text: input.text,
        language: languageOf(input.text, input.locale === 'sl' ? 'sl' : 'en'),
        today: DateTime.formatIsoDateUtc(yield* DateTime.now),
        outline: outlineOf(pieces),
        ...Option.match(about, { onNone: () => ({}), onSome: (value) => ({ about: value }) }),
      }
    })

/** The person's side: sending, listing, reading and watching their chats. */
const chatting = Effect.gen(function* () {
  const threads = yield* StylistThreads
  const index = yield* ChatIndex
  const holds = yield* Holds
  const wardrobe = yield* Wardrobe
  const tastes = yield* Tastes
  const inputOf = inputFor(wardrobe, tastes)

  /** The account's own chat, or `NotFound`. */
  const ownChat = (accountId: string, chatId: string) =>
    Effect.flatMap(stored(index.find(accountId, chatId)), (found) =>
      Option.match(found, { onNone: () => Effect.fail(NotFound.make({})), onSome: Effect.succeed }),
    )

  /** Sending a message: its chat listed, its credit held, then admitted to the chat's Thread. A message refused for
   * good gives its credit back at once; one whose admission was lost on the way is sent again as the same message
   * (same operation id: the same hold, the same admission), or refunded by the settlements sweep. */
  const send = Effect.fn('Styld.Stylist.send')(function* (input: SendChatMessage) {
    const { accountId } = yield* CurrentAccount
    const turnId = yield* turnIdOf(accountId, input.operationId)
    yield* Effect.annotateCurrentSpan('styld.job_id', turnId)
    const chatId = input.chatId ?? (yield* newChatIdOf(accountId, input.operationId))
    if (input.chatId !== undefined) yield* ownChat(accountId, input.chatId)
    const message = yield* inputOf(accountId, input)
    yield* holds.reserve({ accountId, hold: holdOf(turnId), credits: prices.stylistMessage })
    yield* index.touch({ accountId, chatId, title: titleOf(input.text), at: yield* nowDate }).pipe(stored)
    yield* threads
      .submit(accountId, chatId, input.operationId, message)
      .pipe(
        Effect.catchTag('Refused', () =>
          Effect.andThen(
            holds.settle(accountId, holdOf(turnId), 'failed').pipe(Effect.ignore),
            Effect.fail(Unavailable.make({})),
          ),
        ),
      )
    return { chatId: ChatId.make(chatId) }
  })

  return {
    send,
    /** The person's chats, the latest first. */
    chats: Effect.fn('Styld.Stylist.chats')(function* () {
      const { accountId } = yield* CurrentAccount
      const rows = yield* stored(index.list(accountId, listed))
      return {
        chats: rows.map((row) => ({
          id: ChatId.make(row.id),
          title: row.title,
          updatedAt: row.updatedAt.toISOString(),
        })),
      }
    }),
    /** One chat, read from its Thread's canonical records. */
    chat: Effect.fn('Styld.Stylist.chat')(function* (chatId: ChatId) {
      const { accountId } = yield* CurrentAccount
      const found = yield* ownChat(accountId, chatId)
      const { messages, replying } = yield* threads.chat(accountId, chatId)
      return {
        id: chatId,
        title: found.title,
        thread: threadIdOf(accountId, chatId),
        messages,
        ...(replying === undefined ? {} : { replying }),
      }
    }),
    /** The chat's live words while Styld writes them: NDJSON from its Thread, for the person's own chat only. */
    live: Effect.fn('Styld.Stylist.live')(function* (
      chatId: ChatId,
    ): Effect.fn.Return<Stream.Stream<Uint8Array, Unavailable>, NotFound | Unavailable, CurrentAccount> {
      const { accountId } = yield* CurrentAccount
      yield* ownChat(accountId, chatId)
      return threads.live(accountId, chatId)
    }),
  }
})

/** The Threads' side: their tool calls and their settlements. */
const threading = Effect.gen(function* () {
  const holds = yield* Holds
  const wardrobe = yield* Wardrobe
  const worn = yield* Worn
  const tools = yield* StylistTools
  return {
    /** A tool call a chat's Thread asks for, run for the Thread's account. */
    tool: Effect.fn('Styld.Stylist.tool')(function* (request: ToolRequest) {
      const accountId = accountOfThread(request.threadId)
      yield* Effect.annotateCurrentSpan('styld.stylist.tool', request.name)
      return yield* runTool(
        {
          tools: tools.forAccount(accountId),
          pieceIds: wardrobe.listPieces().pipe(
            asAccount(accountId),
            Effect.map((pieces) => new Set<string>(pieces.map(({ id }) => id))),
          ),
          analyze: Effect.gen(function* () {
            const pieces = yield* wardrobe.listPieces()
            const moment = yield* DateTime.now
            const from = Day.make(DateTime.formatIsoDateUtc(DateTime.subtract(moment, { days: analysisDays })))
            const wornDays = yield* worn.listWorn({ from, to: Day.make(DateTime.formatIsoDateUtc(moment)) })
            const analysis = analysisOf(pieces, {
              days: analysisDays,
              pieceIds: wornDays.flatMap(({ pieceIds }) => pieceIds),
            })
            return { analysis, names: new Map<string, string>(pieces.map(({ id, name, type }) => [id, name ?? type])) }
          }).pipe(asAccount(accountId)),
        },
        request,
      )
    }),
    /** A reply ended: its credit is settled by how it ended. The Thread's outbox may say so more than once; the first
     * settlement stands. */
    settle: Effect.fn('Styld.Stylist.settle')(function* (settled: Settled) {
      const turnId = yield* turnIdOf(settled.principal, settled.idempotencyKey)
      yield* holds.settle(settled.principal, holdOf(turnId), endingOf(settled.outcome))
    }),
  }
})

const make = Effect.map(Effect.all([chatting, threading]), ([person, threads]) => ({ ...person, ...threads }))

/** Styld, the stylist in the app: the person's chats and messages, the Threads' tool calls and their settlements. */
export class StylistChats extends Context.Service<StylistChats, Effect.Success<typeof make>>()(
  '@styld/server/stylist/StylistChats',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => StylistChats.of(service)),
  ).pipe(Layer.provide(ChatIndex.layer))
}
