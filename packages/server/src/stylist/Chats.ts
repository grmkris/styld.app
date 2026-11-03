import { Context, type Effect, Layer } from 'effect'
import type { StylistMethods } from './StylistObject.ts'

// Each account's chats as they were before Yielded Agent, in its Durable Object: only erased with the account now.

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
