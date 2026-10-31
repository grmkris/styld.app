import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './schema.ts'

// The outfit engine keeps no outfits (owner, 2026-10-31): only how often each account asked Thinking today, the one
// counter its daily cap needs.

/** How many times an account asked Thinking for outfits on a UTC day (`2026-10-31`). Days before yesterday are swept;
 * the rows go with the account. */
export const thinkingDays = sqliteTable(
  'thinking_days',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    asked: integer('asked').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.day] })],
)
