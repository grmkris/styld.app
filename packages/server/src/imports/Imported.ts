import { importCopies, importedPieces, pieces } from '@styld/db'
import { and, eq, inArray, exists } from 'drizzle-orm'
import type { GeneratedGarment } from '@styld/protocol'
import { Effect } from 'effect'
import { type Database, inChunks, query } from '../kernel/Db.ts'
import { copyRows } from './Copies.ts'
import { type PieceRow, PieceRows, type UploadRow, UploadRows } from '../wardrobe/Store.ts'

/** An import's pieces: each with its photo and the v1 piece it is (`imported_pieces`), and where they stand. Pieces
 * and uploads are written through the wardrobe's statements. */
export const importedRows = (db: Database['Service']) => ({
  ...copyRows(db),
  retryFailed: (accountId: string, pieceId: string, at: Date) =>
    query(() => PieceRows.retryImport(db, accountId, pieceId, at)),
  /** An imported piece, its photo's upload and which v1 piece it is, as one batch: a v1 piece the account already
   * has fails it. A house garment the seed generated is recorded as generated in the same batch, so nothing ever sees
   * it unmarked. */
  createPiece: (upload: UploadRow, piece: PieceRow, v1Id: string, generated: GeneratedGarment | undefined) =>
    query(() =>
      db.batch([
        UploadRows.insertUsed(
          db,
          upload,
          exists(
            db
              .select({ key: importCopies.objectKey })
              .from(importCopies)
              .where(
                and(
                  eq(importCopies.objectKey, upload.objectKey),
                  eq(importCopies.accountId, upload.accountId),
                  eq(importCopies.state, 'copying'),
                ),
              ),
          ),
        ),
        PieceRows.insert(db, piece),
        ...(generated === undefined ? [] : [PieceRows.generated(db, piece, generated)]),
        db.insert(importedPieces).values({ accountId: piece.accountId, v1Id, pieceId: piece.id }),
        db.delete(importCopies).where(eq(importCopies.objectKey, upload.objectKey)),
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
