import { lookPieces, looks, operationReceipts, piecePictures, pieces } from '@styld/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { receiptRows, recordedWrites } from '../kernel/Receipts.ts'
import { forgetCheck } from '../safety/Checks.ts'
import { Database, fenced, first, inChunks, query } from '../kernel/Db.ts'

export type LookRow = typeof looks.$inferSelect
type ReceiptRow = typeof operationReceipts.$inferSelect
type Drizzle = Database['Service']

/** The most looks a piece's page lists. */
const piecesLooks = 50

/** Which of these looks belong to the account: the one ownership check of looks, for boards too. */
export const ownLookIds = (db: Drizzle, accountId: string, lookIds: ReadonlyArray<string>) =>
  Effect.map(
    inChunks(lookIds, (chunk) =>
      db
        .select({ id: looks.id })
        .from(looks)
        .where(and(eq(looks.accountId, accountId), inArray(looks.id, chunk))),
    ),
    (rows) => new Set(rows.map(({ id }) => id)),
  )

/** The statements that write a look and its pieces in order: the one way a look's rows are made, for a board's keep
 * too. */
export const lookRows = (db: Drizzle, look: LookRow, pieceIds: ReadonlyArray<string>) => [
  db.insert(looks).values(look),
  ...pieceIds.map((pieceId, position) => db.insert(lookPieces).values({ lookId: look.id, pieceId, position })),
]

/** Looks and their pieces in D1. Every read and write of a look names the account, but for `looksById`. */
export const lookStore = (db: Drizzle) => ({
  ...receiptRows(db),
  ...recordedWrites(db),
  /** The look, its pieces in order and the operation's receipt, as one atomic batch. */
  createLook: (look: LookRow, pieceIds: ReadonlyArray<string>, receipt: ReceiptRow) =>
    fenced(() => db.batch([db.insert(operationReceipts).values(receipt), ...lookRows(db, look, pieceIds)])).pipe(
      Effect.asVoid,
    ),
  listLooks: (accountId: string) =>
    query(() =>
      db.select().from(looks).where(eq(looks.accountId, accountId)).orderBy(desc(looks.createdAt)).limit(200),
    ),
  /** The account's looks this piece is in, newest first. */
  looksWithPiece: (accountId: string, pieceId: string) =>
    query(() =>
      db
        .select({ look: looks })
        .from(looks)
        .innerJoin(lookPieces, eq(lookPieces.lookId, looks.id))
        .where(and(eq(looks.accountId, accountId), eq(lookPieces.pieceId, pieceId)))
        .orderBy(desc(looks.createdAt))
        .limit(piecesLooks),
    ).pipe(Effect.map((rows) => rows.map(({ look }) => look))),
  /** These looks, whoever's they are: a board's pins read the looks pinned on it. */
  looksById: (lookIds: ReadonlyArray<string>) =>
    inChunks(lookIds, (chunk) => db.select().from(looks).where(inArray(looks.id, chunk))),
  findLook: (accountId: string, lookId: string) =>
    query(() =>
      db
        .select()
        .from(looks)
        .where(and(eq(looks.id, lookId), eq(looks.accountId, accountId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** The pieces of these looks that are still in the wardrobe, in each look's order. */
  piecesOf: (lookIds: ReadonlyArray<string>) =>
    inChunks(lookIds, (chunk) =>
      db
        .select({ lookId: lookPieces.lookId, piece: pieces, picture: piecePictures })
        .from(lookPieces)
        .innerJoin(pieces, eq(pieces.id, lookPieces.pieceId))
        .leftJoin(piecePictures, eq(piecePictures.pieceId, pieces.id))
        .where(inArray(lookPieces.lookId, chunk))
        .orderBy(asc(lookPieces.position)),
    ),
  /** Share the look from this time, or stop sharing it. */
  /** The statement that shares the look or stops sharing it, for its operation's batch (`recorded`). */
  setShared: (accountId: string, lookId: string, sharedAt: Date | null) =>
    db
      .update(looks)
      .set({ sharedAt })
      .where(and(eq(looks.id, lookId), eq(looks.accountId, accountId))),
  /** The look and its check, with the delete's receipt, as one atomic batch; its pieces and pins go with it. */
  deleteLook: (accountId: string, lookId: string, receipt: ReceiptRow) =>
    fenced(() =>
      db.batch([
        db
          .delete(looks)
          .where(and(eq(looks.id, lookId), eq(looks.accountId, accountId)))
          .returning({ id: looks.id }),
        forgetCheck(db, accountId, { kind: 'look', id: lookId }),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.map(([deleted]) => deleted.length > 0)),
})

/** The looks' store over the application's one database. */
export class LookStore extends Context.Service<LookStore, ReturnType<typeof lookStore>>()(
  '@styld/server/looks/LookStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, lookStore))
}
