import { accountOfEmail, createEmailAccount, type NewEmailAccount } from '@styld/auth'
import { operationReceipts, pieces } from '@styld/db'
import { and, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Database, first, inChunks, query } from '../kernel/Db.ts'
import { receiptRows } from '../kernel/Receipts.ts'
import { type PieceRow, PieceRows, type UploadRow, UploadRows } from '../wardrobe/Store.ts'

type Drizzle = Database['Service']
type ReceiptRow = typeof operationReceipts.$inferSelect

/** An import's rows: the account it goes into, each piece with its photo and receipt, and where they stand. Pieces and
 * uploads are written through the wardrobe's statements, the account through auth's. */
const importStore = (db: Drizzle) => ({
  ...receiptRows(db),
  /** The enabled account this verified email signs in to. */
  accountOf: (email: string) => query(() => accountOfEmail(db, email)).pipe(Effect.map(first)),
  /** Make the account for an email that has none, as one batch: an address taken meanwhile fails it. */
  createAccount: (account: NewEmailAccount) =>
    query(() => db.batch(createEmailAccount(db, account))).pipe(Effect.asVoid),
  /** An imported piece, its photo's upload and its receipt, as one batch: a receipt already there fails it. */
  createPiece: (upload: UploadRow, piece: PieceRow, receipt: ReceiptRow) =>
    query(() =>
      db.batch([
        UploadRows.insertUsed(db, upload),
        PieceRows.insert(db, piece),
        db.insert(operationReceipts).values(receipt),
      ]),
    ).pipe(Effect.asVoid),
  /** The receipts of these operations of the account. */
  receiptsOf: (accountId: string, operationIds: ReadonlyArray<string>) =>
    inChunks(operationIds, (chunk) =>
      db
        .select({ operationId: operationReceipts.operationId, result: operationReceipts.result })
        .from(operationReceipts)
        .where(and(eq(operationReceipts.accountId, accountId), inArray(operationReceipts.operationId, chunk))),
    ).pipe(
      Effect.map((rows) =>
        rows.flatMap(({ operationId, result }) => (result === null ? [] : [{ operationId, result }])),
      ),
    ),
  /** Where these pieces of the account stand. */
  statusesOf: (accountId: string, pieceIds: ReadonlyArray<string>) =>
    inChunks(pieceIds, (chunk) =>
      db
        .select({ id: pieces.id, status: pieces.status })
        .from(pieces)
        .where(and(eq(pieces.accountId, accountId), inArray(pieces.id, chunk))),
    ),
})

/** The import's store over the application's one database. */
export class ImportStore extends Context.Service<ImportStore, ReturnType<typeof importStore>>()(
  '@styld/server/imports/ImportStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, importStore))
}
