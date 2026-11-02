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
    accountId: text('account_id').notNull(),
    ending: text('ending', { enum: holdEndings }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('pending_settlements_updated').on(table.updatedAt),
    oneOf('pending_settlements_ending', table.ending, holdEndings),
  ],
)

/** Paid provider work that must run once (`server/src/usage/Attempts.ts`): one row per piece of work, claimed by one
 * delivery at a time, its result kept once the provider answered so a retry resumes from it instead of paying again.
 * A claim no result followed within the lease belongs to a delivery that died after the provider may have taken the
 * work: its outcome is unknown, refunded and never sent again. Kept until its owner explicitly forgets it or the account is deleted. */
export const paidAttempts = sqliteTable(
  'paid_attempts',
  {
    work: text('work').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** Counts the claims; a released claim is taken again as the next attempt. */
    attempt: integer('attempt').notNull(),
    /** The hold the current attempt is paid by, when it holds the account's credits. */
    holdId: text('hold_id'),
    /** When the current attempt was claimed; none once it was released. */
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    /** The work's result as JSON, once stored. */
    result: text('result'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('paid_attempts_updated').on(table.updatedAt)],
)
