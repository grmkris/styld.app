import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { oneOf } from './checks.ts'
import { accounts } from './identity.ts'

// Stored objects still owed a delete (the kernel owns it, `server/src/kernel/MediaDeletions.ts`): a deleted piece's or
// photo's own prefix, written in the same batch that deletes its row, so its objects go even when R2 cannot list or
// delete them at that moment. The row goes once everything under the prefix is gone; the sweep retries what is left.

const mediaOwners = ['piece', 'photo'] as const

export const mediaDeletions = sqliteTable(
  'media_deletions',
  {
    /** The prefix whose every object goes: one deleted row's own, under its account's. */
    prefix: text('prefix').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** What the deleted row was, for logs. */
    owner: text('owner', { enum: mediaOwners }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('media_deletions_created').on(table.createdAt),
    oneOf('media_deletions_owner', table.owner, mediaOwners),
  ],
)
