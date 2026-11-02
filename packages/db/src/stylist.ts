import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './schema.ts'

// Styld's chats live in each account's Durable Object, which nothing can list. D1 keeps only the turns whose credit is
// still held, so the sweep can find a turn whose queue message was lost and settle it from the object's status.

/** A Styld turn whose credit is held: written before the hold, gone once the hold is settled. The rows go with the
 * account. */
export const stylistTurns = sqliteTable(
  'stylist_turns',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('stylist_turns_created').on(table.createdAt)],
)
