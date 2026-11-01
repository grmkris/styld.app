import type * as Cloudflare from '@alchemy.run/cloudflare'
import { CurrentAccount } from '@styld/protocol'
import { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect, Layer } from 'effect'
import type { AssistantTools } from '../mcp/StyldTools.ts'
import { type ChatStore, StylistTools } from './Service.ts'
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
      withdraw: (turnId) => onStub(stub.withdraw(turnId)),
      chat: (chatId, now, patience) => onStub(stub.chat(chatId, now, patience)),
      chats: (limit) => onStub(stub.chats(limit)),
      erase: () => onStub(stub.erase()),
    }
  }

/** Styld's tools for the Worker: the assistants' own (`StyldTools.ts`, built once), each run for the account as an
 * assistant would. */
export const stylistTools = (tools: AssistantTools) =>
  Layer.succeed(
    StylistTools,
    StylistTools.of({
      forAccount: (accountId) =>
        tools.map((tool) => ({
          ...tool,
          run: (args: unknown) =>
            tool.run(args).pipe(Effect.provideService(CurrentAccount, { accountId, via: 'assistant' })),
        })),
    }),
  )
