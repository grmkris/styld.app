import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { oneOf } from './checks.ts'
import { accounts } from './identity.ts'

// Credits (`server/src/usage/`): the Wallet holds them, D1 keeps what must survive a lost call to it.

/** How the work a hold paid for ended. */
const holdEndings = ['succeeded', 'failed', 'unknown'] as const

/** A hold the Wallet has not yet confirmed settled: written before the hold is reserved, its ending recorded as soon as
 * the work ends, gone once the Wallet settled it. The sweep settles what is left, whatever became of the work's own
 * rows; a hold whose work never recorded an ending is refunded after its patience. */
export const pendingSettlements = sqliteTable(
  'pending_settlements',
  {
    holdId: text('hold_id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    ending: text('ending', { enum: holdEndings }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('pending_settlements_updated').on(table.updatedAt),
    oneOf('pending_settlements_ending', table.ending, holdEndings),
  ],
)
