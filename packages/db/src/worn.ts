import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './identity.ts'
import { pieces } from './wardrobe.ts'

// What the person wore, day by day.

/** What the person wore on a day (their own calendar day, `2026-10-30`), in the outfit's order. Deleting a
 * piece takes it out of the days it was worn. The key's prefix serves reads by account and day. */
export const wornPieces = sqliteTable(
  'worn_pieces',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => pieces.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.day, table.pieceId] }),
    index('worn_pieces_piece').on(table.pieceId),
  ],
)
