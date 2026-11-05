import { thinkingDays } from '@styld/db'
import { lt, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Database, query } from '../kernel/Db.ts'
import { receiptRows } from '../kernel/Receipts.ts'

/** The Thinking cap's counter and the engine's receipts over the application's database.
 * @internal Exported for its tests. */
export const outfitStore = (db: Database['Service']) => ({
  ...receiptRows(db),
  /** Count one Thinking request on the day unless the day's `perDay` are spent, in one conditional write: whether it
   * was counted. */
  countThinking: (accountId: string, day: string, perDay: number) =>
    query(() =>
      db
        .insert(thinkingDays)
        .values({ accountId, day, asked: 1 })
        .onConflictDoUpdate({
          target: [thinkingDays.accountId, thinkingDays.day],
          set: { asked: sql`${thinkingDays.asked} + 1` },
          setWhere: lt(thinkingDays.asked, perDay),
        })
        .returning({ asked: thinkingDays.asked }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Forget the days before `day`. */
  sweepBefore: (day: string) => query(() => db.delete(thinkingDays).where(lt(thinkingDays.day, day))),
})

/** The outfit engine's store over the application's one database. */
export class OutfitStore extends Context.Service<OutfitStore, ReturnType<typeof outfitStore>>()(
  '@styld/server/outfits/OutfitStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, outfitStore))
}
