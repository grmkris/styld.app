import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './identity.ts'

// Styld's chats: their index per account; each chat's messages live in its Thread.

/** Each account's chats with Styld, newest first in a list: the index of the chats whose messages each live in their
 * own Thread (Yielded Agent, `server/src/stylist/Thread.ts`). A chat's row is written before its first message is
 * admitted; its title is that message, cut. The rows go with the account. */
export const stylistChats = sqliteTable(
  'stylist_chats',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('stylist_chats_account_updated').on(table.accountId, table.updatedAt)],
)
