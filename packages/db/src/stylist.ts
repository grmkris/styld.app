import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './identity.ts'

// Styld's chats: their index per account; each chat's messages live in its Thread. D1 also keeps the turns whose credit is
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
