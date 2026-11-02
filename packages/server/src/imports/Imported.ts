import { importedPieces, pieces } from '@styld/db'
import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import { type Database, inChunks, query } from '../kernel/Db.ts'
import { type PieceRow, PieceRows, type UploadRow, UploadRows } from '../wardrobe/Store.ts'

/** An import's pieces: each with its photo and the v1 piece it is (`imported_pieces`), and where they stand. Pieces
 * and uploads are written through the wardrobe's statements. */
export const importedRows = (db: Database['Service']) => ({
  /** An imported piece, its photo's upload and which v1 piece it is, as one batch: a v1 piece the account already
   * has fails it. */
  createPiece: (upload: UploadRow, piece: PieceRow, v1Id: string) =>
    query(() =>
      db.batch([
        UploadRows.insertUsed(db, upload),
        PieceRows.insert(db, piece),
        db.insert(importedPieces).values({ accountId: piece.accountId, v1Id, pieceId: piece.id }),
      ]),
    ).pipe(Effect.asVoid),
  /** The pieces these v1 pieces became in the account. */
  importedOf: (accountId: string, v1Ids: ReadonlyArray<string>) =>
    inChunks(v1Ids, (chunk) =>
      db
        .select({ v1Id: importedPieces.v1Id, pieceId: importedPieces.pieceId })
        .from(importedPieces)
        .where(and(eq(importedPieces.accountId, accountId), inArray(importedPieces.v1Id, chunk))),
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
