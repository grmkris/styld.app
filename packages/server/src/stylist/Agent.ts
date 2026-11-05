import { Audience, ChatMessage, Language, Learned, Occasions, Replying } from '@styld/protocol'
import { DefinitionDigestInput } from '@yielded/agent/records'
import { AgentId, ThreadId } from '@yielded/agent/identifiers'
import { Schema } from 'effect'
import { textModels } from '../providers/Costs.ts'
import { catalogue } from './Catalogue.ts'

// Styld's chat as a Yielded Agent (owner, 3 November 2026): one Thread per chat, hosted by its own Worker
// (`ThreadWorker.ts`). What the API Worker and the Thread both need to agree on lives here: the agent's id, its
// input, the Thread of a chat and the definitions both sides digest.

/** What Styld knows about how the person dresses (`taste/`), as a reply is told it: what they chose to see first, the
 * occasions they dress for, the notes they said yes to keeping, and what was learned from what they saved and wore. */
export const StylistAbout = Schema.Struct({
  showMe: Schema.NullOr(Audience),
  occasions: Occasions,
  notes: Schema.Array(Schema.String),
  learned: Learned,
})
export type StylistAbout = typeof StylistAbout.Type

/** What admits a reply: the person's message, and what the API Worker read for it (the language to answer in, today's
 * date, the wardrobe in a line, what Styld knows about the person). The browser never writes these: the API Worker
 * builds them from the session. `about` is optional: messages admitted before it existed still read back. */
export const StylistInput = Schema.Struct({
  text: Schema.String,
  language: Language,
  today: Schema.String,
  outline: Schema.Struct({
    pieces: Schema.Int,
    byType: Schema.Record(Schema.String, Schema.Int),
    colours: Schema.Array(Schema.String),
  }),
  about: Schema.optionalKey(StylistAbout),
})
export type StylistInput = typeof StylistInput.Type

export const stylistAgentId = AgentId.make('styld-stylist')

/** The agent as a submission names it: its id and input. */
export const stylistSubmitAgent = { definition: { id: stylistAgentId, input: StylistInput } }

/** The model the chat answers with, as the definitions name it (`Policy.ts` `styldModel`). */
export const stylistModelName = textModels.museSpark.id

/** A chat's Thread: the account's id and the chat's, joined by the API Worker from the session, never from the
 * browser. Thread Objects are named by it. */
export const threadIdOf = (accountId: string, chatId: string) => ThreadId.make(`${accountId}--${chatId}`)

/** The account a Thread belongs to. */
export const accountOfThread = (threadId: string) => threadId.slice(0, Math.max(0, threadId.indexOf('--')))

/** What admission checks a submission against: the agent's version, its model and its tools. A change to any of them
 * is a new version of the definition, so a Thread never runs a reply admitted for another. */
export const stylistDefinitions = DefinitionDigestInput.make({
  agent: { id: stylistAgentId, version: 1 },
  model: { provider: 'styld', model: stylistModelName },
  tools: catalogue.map(({ name, execution }) => ({ name, execution })),
})

// The two Workers call each other over service bindings, never through each other's Objects.

/** A tool call a Thread asks the API Worker to run for the chat's account. */
export interface ToolRequest {
  readonly threadId: string
  readonly submissionId: string
  readonly name: string
  readonly params: unknown
}

/** How a reply ended, as the API Worker settles its credit: its account and the operation id it was sent with. */
export interface Settled {
  readonly principal: string
  readonly idempotencyKey: string
  readonly outcome: 'completed' | 'failed' | 'aborted' | 'unknown'
}

/** The API Worker's methods a Thread calls (`StyldWorker.ts`). */
export interface StyldApi {
  readonly stylistTool: (request: ToolRequest) => Promise<unknown>
  readonly stylistSettled: (settled: Settled) => Promise<void>
}

/** A message to admit to its chat's Thread, for the account the API Worker read from the session. */
export interface Admit {
  readonly accountId: string
  readonly chatId: string
  readonly operationId: string
  readonly input: StylistInput
}

/** How an admission ended: admitted (again, for a repeat), the same operation id with another message, refused for
 * good, or not known (the request may be sent again as the same message). */
export const Admission = Schema.Literals(['admitted', 'conflict', 'refused', 'unknown'])
export type Admission = typeof Admission.Type

/** A chat as its Thread's canonical records tell it (`History.ts`). */
export const ChatRead = Schema.Struct({ messages: Schema.Array(ChatMessage), replying: Schema.optionalKey(Replying) })
export type ChatRead = typeof ChatRead.Type

/** The Thread Worker's methods the API Worker calls (`Thread.ts`). Each names the account and the chat; the Thread
 * Worker joins them into the Thread's id. */
export interface StylistThreadsApi {
  readonly admit: (request: Admit) => Promise<Admission>
  readonly chat: (accountId: string, chatId: string) => Promise<ChatRead>
  /** The chat's live words (LiveText NDJSON), as its Thread writes them. */
  readonly live: (accountId: string, chatId: string) => Promise<ReadableStream<Uint8Array>>
  /** Forget the account's chats for good: each Thread's storage and alarm (account deletion). */
  readonly erase: (accountId: string, chatIds: ReadonlyArray<string>) => Promise<void>
}
