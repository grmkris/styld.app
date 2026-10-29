import { accounts, operationReceipts, pieces, uploads } from '@styld/db'
import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Option, Schema } from 'effect'

/** D1 did not answer; the request may be retried. */
export class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()('StoreUnavailable', {}) {}

export type PieceRow = typeof pieces.$inferSelect
export type UploadRow = typeof uploads.$inferSelect
export type ReceiptRow = typeof operationReceipts.$inferSelect

export type PieceChanges = Partial<
  Pick<PieceRow, 'name' | 'notes' | 'category' | 'subcategory' | 'colours' | 'updatedAt'>
>

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })

const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

/** Uploads, and whether their account still takes photos. */
const uploadQueries = (db: ReturnType<typeof drizzle>) => ({
  accountEnabled: (accountId: string) =>
    attempt(() =>
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.enabled, true)))
        .limit(1),
    ).pipe(Effect.map((rows) => rows.length === 1)),
  insertUpload: (row: UploadRow) => attempt(() => db.insert(uploads).values(row)).pipe(Effect.asVoid),
  findUpload: (uploadId: string) =>
    attempt(() => db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1)).pipe(Effect.map(first)),
  markUploadReceived: (uploadId: string) =>
    attempt(() =>
      db
        .update(uploads)
        .set({ status: 'received' })
        .where(and(eq(uploads.id, uploadId), eq(uploads.status, 'pending'))),
    ).pipe(Effect.asVoid),
})

/** The wardrobe's rows in D1. Every read and write of a person's rows names their account, so
 * one account can never reach another's pieces. */
export const makeStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return {
    ...uploadQueries(db),
    listPieces: (accountId: string) =>
      attempt(() => db.select().from(pieces).where(eq(pieces.accountId, accountId)).orderBy(desc(pieces.createdAt))),
    findPiece: (accountId: string, pieceId: string) =>
      attempt(() =>
        db
          .select()
          .from(pieces)
          .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
          .limit(1),
      ).pipe(Effect.map(first)),
    /** For the processing queue, which acts for no one in particular. */
    findPieceForProcessing: (pieceId: string) =>
      attempt(() => db.select().from(pieces).where(eq(pieces.id, pieceId)).limit(1)).pipe(Effect.map(first)),
    findReceipt: (accountId: string, operationId: string) =>
      attempt(() =>
        db
          .select()
          .from(operationReceipts)
          .where(and(eq(operationReceipts.accountId, accountId), eq(operationReceipts.operationId, operationId)))
          .limit(1),
      ).pipe(Effect.map(first)),
    /** The piece, its upload spent and the operation's receipt, as one atomic batch. The unique
     * upload id fails the whole batch when the upload already made a piece. */
    addPiece: (piece: PieceRow, receipt: ReceiptRow) =>
      Effect.tryPromise({
        try: () =>
          db.batch([
            db.insert(pieces).values(piece),
            db.update(uploads).set({ status: 'used' }).where(eq(uploads.id, piece.uploadId)),
            db.insert(operationReceipts).values(receipt),
          ]),
        catch: () => StoreUnavailable.make({}),
      }).pipe(Effect.asVoid),
    updatePiece: (accountId: string, pieceId: string, changes: PieceChanges) =>
      attempt(() =>
        db
          .update(pieces)
          .set(changes)
          .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
          .returning(),
      ).pipe(Effect.map(first)),
    /** Removes the piece and its upload; returns the piece so its photos can be deleted. */
    deletePiece: (accountId: string, pieceId: string) =>
      attempt(() =>
        db
          .delete(pieces)
          .where(and(eq(pieces.id, pieceId), eq(pieces.accountId, accountId)))
          .returning(),
      ).pipe(
        Effect.map(first),
        Effect.tap((deleted) =>
          Option.match(deleted, {
            onNone: () => Effect.void,
            onSome: ({ uploadId }) => attempt(() => db.delete(uploads).where(eq(uploads.id, uploadId))),
          }),
        ),
      ),
    /** Records the processed photo; a piece no longer processing is left as it is. */
    finishProcessing: (pieceId: string, changes: Pick<PieceRow, 'status' | 'imageKey' | 'updatedAt'>) =>
      attempt(() =>
        db
          .update(pieces)
          .set(changes)
          .where(and(eq(pieces.id, pieceId), eq(pieces.status, 'processing'))),
      ).pipe(Effect.asVoid),
  }
}

export type Store = ReturnType<typeof makeStore>
