import { stylistChats } from '@styld/db'
import { and, desc, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Database, first, query } from '../kernel/Db.ts'

/** Each account's chats with Styld, in D1: their titles and when each last changed. A chat's messages live in its
 * Thread; this index is what lists them, and what says a chat is the account's own.
 * @internal Exported for its tests. */
export const chatIndex = (db: Database['Service']) => ({
  /** The chat, if it is the account's. */
  find: (accountId: string, chatId: string) =>
    query(() =>
      db
        .select({ id: stylistChats.id, title: stylistChats.title })
        .from(stylistChats)
        .where(and(eq(stylistChats.id, chatId), eq(stylistChats.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** A chat whose message is about to be admitted: a new one with its title, or one changed now. Opening the same
   * chat again keeps its title. */
  touch: (input: { readonly accountId: string; readonly chatId: string; readonly title: string; readonly at: Date }) =>
    query(() =>
      db
        .insert(stylistChats)
        .values({
          id: input.chatId,
          accountId: input.accountId,
          title: input.title,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .onConflictDoUpdate({
          target: stylistChats.id,
          set: { updatedAt: input.at },
          setWhere: eq(stylistChats.accountId, input.accountId),
        }),
    ).pipe(Effect.asVoid),
  /** The account's chats, the latest first. */
  list: (accountId: string, limit: number) =>
    query(() =>
      db
        .select({ id: stylistChats.id, title: stylistChats.title, updatedAt: stylistChats.updatedAt })
        .from(stylistChats)
        .where(eq(stylistChats.accountId, accountId))
        .orderBy(desc(stylistChats.updatedAt))
        .limit(limit),
    ),
  /** Every chat of the account, for its deletion. */
  all: (accountId: string) =>
    query(() =>
      db.select({ id: stylistChats.id }).from(stylistChats).where(eq(stylistChats.accountId, accountId)),
    ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
})

/** Styld's chat index over the application's one database. */
export class ChatIndex extends Context.Service<ChatIndex, ReturnType<typeof chatIndex>>()(
  '@styld/server/stylist/ChatIndex',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, chatIndex))
}
