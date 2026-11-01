import type { StylistTurn } from './Queue.ts'
import type * as Cloudflare from '@alchemy.run/cloudflare'
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { Context, Effect, Layer } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import type { Holds } from '../usage/Holds.ts'
import { CurrentAccount } from '@styld/protocol'
import type { AssistantTools } from '../mcp/StyldTools.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { stylistModelId } from './Policy.ts'
import type { StylistModel } from '../Providers.ts'
import { type ChatStore, makeStylist } from './Service.ts'
import type { Stylist } from './StylistObject.ts'
import { type RunChat, workersAiFetch } from '../ai/WorkersAiFetch.ts'

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

/** The model Styld answers with, on Workers AI through the Worker's binding, as an OpenAI-compatible model. */
export const stylistModel = (runChat: RunChat): StylistModel['Service'] => ({
  model: stylistModelId,
  layer: OpenAiLanguageModel.model(stylistModelId).pipe(
    Layer.provide(OpenAiClient.layer({ apiUrl: 'https://workers-ai.invalid/v1' })),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, workersAiFetch(runChat))),
  ),
})

/** Styld for the Worker: its model, the assistants' own tools run for the account, and the chats in each account's
 * Durable Object. */
export const makeStylistLive = (input: {
  readonly model: StylistModel['Service']
  readonly chatsOf: (accountId: string) => ChatStore
  readonly queue: { send(message: StylistTurn): Promise<unknown> }
  /** The assistants' tools (`StyldTools.ts`), built once for the Worker. */
  readonly tools: AssistantTools
  /** The wardrobe, and the credits and call counter the capture providers were built with. */
  readonly storage: {
    readonly wardrobeService: Wardrobe['Service']
    readonly holds: Holds['Service']
    readonly metrics: CaptureMetrics['Service']
  }
}) =>
  Effect.gen(function* () {
    return yield* makeStylist({
      chatsOf: input.chatsOf,
      queue: input.queue,
      model: input.model,
      tools: input.tools,
      toolContext: (accountId) => Context.make(CurrentAccount, { accountId, via: 'assistant' }),
      wardrobe: input.storage.wardrobeService,
      holds: input.storage.holds,
      metrics: input.storage.metrics,
    })
  }).pipe(Effect.provide(layerCryptoWeb))
