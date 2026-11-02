import { wornPieces } from '@styld/db'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { type Database, query } from '../kernel/Db.ts'

const ofDay = (accountId: string, day: string) => and(eq(wornPieces.accountId, accountId), eq(wornPieces.day, day))

/** What the person wore, by day, in D1. Every read and write names the account. */
export const wornStore = (db: Database['Service']) => {
  return {
    /** The pieces worn from one day to another, both included, by day and in each day's order. A deleted
     * piece has already left the days it was worn. */
    wornBetween: (accountId: string, from: string, to: string) =>
      query(() =>
        db
          .select({ day: wornPieces.day, pieceId: wornPieces.pieceId })
          .from(wornPieces)
          .where(and(eq(wornPieces.accountId, accountId), gte(wornPieces.day, from), lte(wornPieces.day, to)))
          .orderBy(asc(wornPieces.day), asc(wornPieces.position)),
      ),
    /** The statements that replace the day's pieces, for their operation's batch (`recorded`). */
    wear: (accountId: string, day: string, pieceIds: ReadonlyArray<string>) => [
      db.delete(wornPieces).where(ofDay(accountId, day)),
      ...pieceIds.map((pieceId, position) => db.insert(wornPieces).values({ accountId, day, pieceId, position })),
    ],
    /** The statement that clears the day, for its operation's batch. */
    clear: (accountId: string, day: string) => db.delete(wornPieces).where(ofDay(accountId, day)),
  }
}
