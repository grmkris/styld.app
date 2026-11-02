import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './identity.ts'
import { pieces } from './wardrobe.ts'

// Wardrobes brought over from v1 (`server/src/imports/`).

/** Which piece each v1 piece became in an account: written in the batch that makes the piece, so a v1 piece is
 * imported into an account once, whichever bundle carries it and however often an import is started. The mapping
 * lasts as long as its piece. */
export const importedPieces = sqliteTable(
  'imported_pieces',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    v1Id: text('v1_id').notNull(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.v1Id] }), index('imported_pieces_piece').on(table.pieceId)],
)
