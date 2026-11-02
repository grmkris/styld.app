import { stylistTurns } from '@styld/db'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Database, first, query } from '../kernel/Db.ts'

/** The turns whose credit is held, in D1: the one index of Styld's turns the sweep can read, since the chats
 * themselves are in each account's Durable Object.
 * @internal Exported for its tests. */
export const turnStore = (db: Database['Service']) => ({
  /** A turn about to hold its credit; opening it again is the same turn. */
  open: (turnId: string, accountId: string, at: Date) =>
    query(() => db.insert(stylistTurns).values({ id: turnId, accountId, createdAt: at }).onConflictDoNothing()).pipe(
      Effect.asVoid,
    ),
  /** Whose turn it is, while its credit is held. */
  find: (turnId: string) =>
    query(() =>
      db.select({ accountId: stylistTurns.accountId }).from(stylistTurns).where(eq(stylistTurns.id, turnId)).limit(1),
    ).pipe(Effect.map(first)),
  /** A turn whose credit is settled. */
  close: (turnId: string) =>
    query(() => db.delete(stylistTurns).where(eq(stylistTurns.id, turnId))).pipe(Effect.asVoid),
})

/** Styld's open turns over the application's one database. */
export class StylistTurns extends Context.Service<StylistTurns, ReturnType<typeof turnStore>>()(
  '@styld/server/stylist/StylistTurns',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, turnStore))
}
