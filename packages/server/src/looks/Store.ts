import { lookPieces, looks, operationReceipts, pieces } from '@styld/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { receiptQuery } from '../Receipts.ts'
import { chunked, ownPieceIds, StoreUnavailable } from '../wardrobe/Store.ts'

export type LookRow = typeof looks.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })

/** Looks and their pieces in D1. Every read and write names the account. */
export const makeLookStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  /** The pieces of these looks that are still in the wardrobe, in each look's order. */
  const piecesOf = (lookIds: ReadonlyArray<string>) =>
    Effect.map(
      Effect.forEach(chunked(lookIds), (chunk) =>
        attempt(() =>
          db
            .select({ lookId: lookPieces.lookId, piece: pieces })
            .from(lookPieces)
            .innerJoin(pieces, eq(pieces.id, lookPieces.pieceId))
            .where(inArray(lookPieces.lookId, chunk))
            .orderBy(asc(lookPieces.position)),
        ),
      ),
      (rows) => rows.flat(),
    )
  return {
    /** The look, its pieces in order and the operation's receipt, as one atomic batch. */
    createLook: (look: LookRow, pieceIds: ReadonlyArray<string>, receipt: ReceiptRow) =>
      attempt(() =>
        db.batch([
          db.insert(looks).values(look),
          ...pieceIds.map((pieceId, position) => db.insert(lookPieces).values({ lookId: look.id, pieceId, position })),
          db.insert(operationReceipts).values(receipt),
        ]),
      ).pipe(Effect.asVoid),
    /** Which of these pieces belong to the account. */
    ownPieces: (accountId: string, pieceIds: ReadonlyArray<string>) => ownPieceIds(db, accountId, pieceIds),
    findReceipt: (accountId: string, operationId: string) =>
      attempt(() => receiptQuery(db, accountId, operationId)).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),
    listLooks: (accountId: string) =>
      attempt(() =>
        db.select().from(looks).where(eq(looks.accountId, accountId)).orderBy(desc(looks.createdAt)).limit(200),
      ),
    /** These looks, whoever's they are: a board's pins read the looks pinned on it. */
    looksById: (lookIds: ReadonlyArray<string>) =>
      Effect.map(
        Effect.forEach(chunked(lookIds), (chunk) =>
          attempt(() => db.select().from(looks).where(inArray(looks.id, chunk))),
        ),
        (rows) => rows.flat(),
      ),
    /** Which of these looks belong to the account. */
    ownLooks: (accountId: string, lookIds: ReadonlyArray<string>) =>
      Effect.map(
        Effect.forEach(chunked(lookIds), (chunk) =>
          attempt(() =>
            db
              .select({ id: looks.id })
              .from(looks)
              .where(and(eq(looks.accountId, accountId), inArray(looks.id, chunk))),
          ),
        ),
        (rows) => new Set(rows.flat().map(({ id }) => id)),
      ),
    findLook: (accountId: string, lookId: string) =>
      attempt(() =>
        db
          .select()
          .from(looks)
          .where(and(eq(looks.id, lookId), eq(looks.accountId, accountId)))
          .limit(1),
      ).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),
    piecesOf,
    /** Share the look from this time, or stop sharing it. */
    setShared: (accountId: string, lookId: string, sharedAt: Date | null) =>
      attempt(() =>
        db
          .update(looks)
          .set({ sharedAt })
          .where(and(eq(looks.id, lookId), eq(looks.accountId, accountId))),
      ).pipe(Effect.asVoid),
    deleteLook: (accountId: string, lookId: string) =>
      attempt(() =>
        db
          .delete(looks)
          .where(and(eq(looks.id, lookId), eq(looks.accountId, accountId)))
          .returning({ id: looks.id }),
      ).pipe(Effect.map((rows) => rows.length > 0)),
  }
}

export type LookStore = ReturnType<typeof makeLookStore>
