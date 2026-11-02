import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './identity.ts'
import { pieces } from './wardrobe.ts'
import { oneOf } from './checks.ts'

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

/** An import copy not yet adopted by its piece. It survives account deletion until its R2 object is deleted. */
export const importCopies = sqliteTable(
  'import_copies',
  {
    objectKey: text('object_key').primaryKey(),
    accountId: text('account_id').notNull(),
    state: text('state', { enum: ['copying', 'discarding'] })
      .notNull()
      .default('copying'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('import_copies_created').on(table.createdAt),
    oneOf('import_copies_state', table.state, ['copying', 'discarding']),
  ],
)
