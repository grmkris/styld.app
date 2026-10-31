import { thinkingDays } from '@styld/db'
import { lt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { StoreUnavailable } from '../wardrobe/Store.ts'

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })

/** The Thinking cap's counter over D1. */
export const makeOutfitStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return {
    /** Count one Thinking request on the day unless the day's `perDay` are spent, in one conditional write: whether it
     * was counted. */
    countThinking: (accountId: string, day: string, perDay: number) =>
      attempt(() =>
        db
          .insert(thinkingDays)
          .values({ accountId, day, asked: 1 })
          .onConflictDoUpdate({
            target: [thinkingDays.accountId, thinkingDays.day],
            set: { asked: sql`${thinkingDays.asked} + 1` },
            setWhere: sql`${thinkingDays.asked} < ${perDay}`,
          })
          .returning({ asked: thinkingDays.asked }),
      ).pipe(Effect.map((rows) => rows.length > 0)),
    /** Forget the days before `day`. */
    sweepBefore: (day: string) => attempt(() => db.delete(thinkingDays).where(lt(thinkingDays.day, day))),
  }
}
export type OutfitStore = ReturnType<typeof makeOutfitStore>
