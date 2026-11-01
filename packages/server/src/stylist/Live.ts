import type { StylistTurn } from './Queue.ts'
import type * as Cloudflare from '@alchemy.run/cloudflare'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { Context, Effect } from 'effect'
import { LanguageModel } from 'effect/ai'
import { workersAiModel } from '../ai/LanguageModel.ts'
import type { Holds } from '../usage/Holds.ts'
import { CurrentAccount } from '@styld/protocol'
import type { AssistantTools } from '../mcp/StyldTools.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { styldModel } from './Policy.ts'
import { type ChatStore, makeStylist } from './Service.ts'
import type { Stylist } from './StylistObject.ts'

/** A call through a Durable Object stub. Its methods carry `RuntimeContext` in their type only: the stub is the
 * binding's own and needs nothing from the request at run time, so the requirement is discharged. */
const onStub = <A, E>(call: Effect.Effect<A, E, RuntimeContext>) => call.pipe(Effect.provide(RuntimeContext.phantom))

/** One account's chats, through its Durable Object. */
export const chatStoreOf =
  (stylists: Cloudflare.DurableObject<Stylist>) =>
  (accountId: string): ChatStore => {
    const stub = stylists.getByName(accountId)
    return {
      begin: (input) => onStub(stub.begin(input)),
      turn: (turnId) => onStub(stub.turn(turnId)),
      progress: (turnId, text, parts) => onStub(stub.progress(turnId, text, parts)),
      finish: (input) => onStub(stub.finish(input)),
      chat: (chatId, now, patience) => onStub(stub.chat(chatId, now, patience)),
      chats: (limit) => onStub(stub.chats(limit)),
      erase: () => onStub(stub.erase()),
    }
  }

/** Styld for the Worker: its model on Workers AI, the assistants' own tools run for the account, and the chats in
 * each account's Durable Object. */
export const makeStylistLive = (input: {
  readonly chatsOf: (accountId: string) => ChatStore
  readonly queue: { send(message: StylistTurn): Promise<unknown> }
  /** The assistants' tools (`StyldTools.ts`), built once for the Worker. */
  readonly tools: AssistantTools
  /** The wardrobe, and the credits the capture providers were built with. */
  readonly storage: {
    readonly wardrobeService: Wardrobe['Service']
    readonly holds: Holds['Service']
  }
}) =>
  Effect.gen(function* () {
    return yield* makeStylist({
      chatsOf: input.chatsOf,
      queue: input.queue,
      model: yield* LanguageModel.LanguageModel,
      tools: input.tools,
      toolContext: (accountId) => Context.make(CurrentAccount, { accountId, via: 'assistant' }),
      wardrobe: input.storage.wardrobeService,
      holds: input.storage.holds,
    })
  }).pipe(Effect.provide([layerCryptoWeb, workersAiModel(styldModel)]))
