import { wornPieces } from '@styld/db'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'
import { ownPieceIds } from '../wardrobe/Store.ts'
import { query } from '../kernel/Db.ts'

const ofDay = (accountId: string, day: string) => and(eq(wornPieces.accountId, accountId), eq(wornPieces.day, day))

/** What the person wore, by day, in D1. Every read and write names the account. */
export const makeWornStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return {
    ownPieces: (accountId: string, pieceIds: ReadonlyArray<string>) => ownPieceIds(db, accountId, pieceIds),
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
    /** Replace the day's pieces, as one atomic batch. */
    wear: (accountId: string, day: string, pieceIds: ReadonlyArray<string>) =>
      query(() =>
        db.batch([
          db.delete(wornPieces).where(ofDay(accountId, day)),
          ...pieceIds.map((pieceId, position) => db.insert(wornPieces).values({ accountId, day, pieceId, position })),
        ]),
      ).pipe(Effect.asVoid),
    clear: (accountId: string, day: string) =>
      query(() => db.delete(wornPieces).where(ofDay(accountId, day))).pipe(Effect.asVoid),
  }
}

export type WornStore = ReturnType<typeof makeWornStore>
