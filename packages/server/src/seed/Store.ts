import { importedPieces, pieceProvenance, pieces, seededBoards } from '@styld/db'
import { and, eq, like } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Database, first, query } from '../kernel/Db.ts'

// The house boards' own rows (owner, 4 November 2026): which board each catalogue entry became, for good, and reads of
// the house garments the import made (`imported_pieces` with `seed:<manifest id>`).

export type SeededRow = typeof seededBoards.$inferSelect

/** The prefix of a house garment's v1 id in `imported_pieces`: `seed:<manifest id>`. */
export const seedPrefix = 'seed:'

/** The seed's statements, for its batches: an entry's board recorded (or its new version), or forgotten. */
export const SeedRows = {
  recorded: (db: Database['Service'], row: SeededRow) =>
    db
      .insert(seededBoards)
      .values(row)
      .onConflictDoUpdate({
        target: [seededBoards.accountId, seededBoards.seedId],
        set: { boardId: row.boardId, version: row.version, digest: row.digest },
      }),
}

const seedStore = (db: Database['Service']) => ({
  /** The board this account's catalogue entry became, if it was seeded. */
  seededAs: (accountId: string, seedId: string) =>
    query(() =>
      db
        .select()
        .from(seededBoards)
        .where(and(eq(seededBoards.accountId, accountId), eq(seededBoards.seedId, seedId)))
        .limit(1),
    ).pipe(Effect.map(first)),
  /** Every house garment the account's import made: its manifest id, its piece as it stands, and its provenance. */
  houseGarments: (accountId: string) =>
    query(() =>
      db
        .select({
          v1Id: importedPieces.v1Id,
          pieceId: pieces.id,
          status: pieces.status,
          type: pieces.type,
          imageKey: pieces.imageKey,
          originalKey: pieces.originalKey,
          origin: pieceProvenance.origin,
          describedType: pieceProvenance.describedType,
          describedWhole: pieceProvenance.describedWhole,
        })
        .from(importedPieces)
        .innerJoin(pieces, eq(pieces.id, importedPieces.pieceId))
        .leftJoin(pieceProvenance, eq(pieceProvenance.pieceId, pieces.id))
        .where(and(eq(importedPieces.accountId, accountId), like(importedPieces.v1Id, `${seedPrefix}%`))),
    ),
})

/** The seed's store over the application's one database. */
export class SeedStore extends Context.Service<SeedStore, ReturnType<typeof seedStore>>()(
  '@styld/server/seed/SeedStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, seedStore))
}
