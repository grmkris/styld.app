import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './identity.ts'

// Every idempotent write's receipt (`server/src/kernel/Receipts.ts`): written in the operation's own batch by whichever
// module runs it, swept after thirty days.

/** The answer to each operation id, so a repeated request returns it instead of acting twice. */
export const operationReceipts = sqliteTable(
  'operation_receipts',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    command: text('command').notNull(),
    inputDigest: text('input_digest').notNull(),
    result: text('result').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.operationId] }),
    index('operation_receipts_created').on(table.createdAt),
  ],
)
