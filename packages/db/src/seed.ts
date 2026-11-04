import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { boards } from './boards.ts'
import { accounts } from './identity.ts'

// The house boards the operator seeds (`server/src/seed/`, owner 4 November 2026).

/** Which board each entry of the seed catalogue became in a house account, for good: operation receipts are forgotten
 * after 30 days, so a run months later finds its boards here. `digest` is of the entry last applied: the same entry
 * changes nothing, a changed one updates the same board. */
export const seededBoards = sqliteTable(
  'seeded_boards',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    seedId: text('seed_id').notNull(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    digest: text('digest').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.seedId] }), index('seeded_boards_board').on(table.boardId)],
)
