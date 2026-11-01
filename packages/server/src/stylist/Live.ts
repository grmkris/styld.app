import type * as Cloudflare from '@alchemy.run/cloudflare'
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import { layerCryptoWeb } from '@yielded/auth/WebCrypto'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { Context, Effect, Layer, Redacted } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import type { CaptureMetrics } from '../capture/Metrics.ts'
import type { Usage } from '../capture/Usage.ts'
import { CurrentAccount } from '../CurrentAccount.ts'
import { publicClient } from '../mcp/ImageImport.ts'
import { Pacing } from '../mcp/Pacing.ts'
import { styldTools, type ToolServices } from '../mcp/StyldTools.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { type StylistPolicy, stylistPolicy } from './Policy.ts'
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

/** The model Styld answers with: on Workers AI through the binding (GLM thinks briefly), or through an
 * OpenAI-compatible gateway with its key. */
const stylistModel = (policy: StylistPolicy, runChat: RunChat, key: unknown) => {
  const viaBinding = policy.mode === 'workers-ai'
  const fetch = workersAiFetch(runChat, policy.model.startsWith('@cf/zai-org/glm') ? { reasoning_effort: 'low' } : {})
  return OpenAiLanguageModel.model(policy.model).pipe(
    Layer.provide(
      OpenAiClient.layer(
        viaBinding
          ? { apiUrl: 'https://workers-ai.invalid/v1' }
          : { apiUrl: policy.apiBase, apiKey: Redacted.make(typeof key === 'string' ? key : '') },
      ),
    ),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(viaBinding ? Layer.succeed(FetchHttpClient.Fetch, fetch) : Layer.empty),
  )
}

/** The stylist's tools never fetch from the web or generate pictures, the only paced work: were one given such a
 * tool, it would be told to slow down. */
const unpaced: Pacing['Service'] = { link: () => Effect.succeed(false), generate: () => Effect.succeed(false) }

/** Styld for the Worker: its policy and model from the environment, the assistants' own tools run for the account,
 * and the chats in each account's Durable Object. */
export const makeStylistLive = (input: {
  readonly env: Readonly<Record<string, unknown>>
  readonly chatsOf: (accountId: string) => ChatStore
  readonly queue: { send(message: { readonly stylistTurnOf: string; readonly accountId: string }): Promise<unknown> }
  readonly runChat: RunChat
  readonly tools: ToolServices
  /** The wardrobe, and the credits and call counter the capture providers were built with. */
  readonly storage: {
    readonly wardrobeService: Wardrobe['Service']
    readonly usage: Usage['Service']
    readonly metrics: CaptureMetrics['Service']
  }
}) =>
  Effect.gen(function* () {
    const policy = stylistPolicy(input.env)
    const origin: unknown = input.env['AUTH_ORIGIN']
    const http = yield* publicClient.pipe(Effect.provide(FetchHttpClient.layer))
    return yield* makeStylist({
      chatsOf: input.chatsOf,
      queue: input.queue,
      policy,
      model: stylistModel(policy, input.runChat, input.env['STYLIST_GATEWAY_API_KEY']),
      tools: styldTools(typeof origin === 'string' ? origin : '', input.tools, http),
      toolContext: (accountId) =>
        Context.make(CurrentAccount, { accountId, via: 'assistant' }).pipe(Context.add(Pacing, unpaced)),
      wardrobe: input.storage.wardrobeService,
      usage: input.storage.usage,
      metrics: input.storage.metrics,
    })
  }).pipe(Effect.provide(layerCryptoWeb))
