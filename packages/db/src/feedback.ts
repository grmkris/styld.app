import { FeedbackKind, FeedbackStatus } from '@styld/protocol'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { oneOf } from './checks.ts'
import { accounts } from './identity.ts'

// What assistants tell Styld about Styld (owner, 4 November 2026; the MCP module owns it): one row per note a day, its
// repeats counted, kept 180 days, read and marked handled only by admins.

export const assistantFeedback = sqliteTable(
  'assistant_feedback',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: FeedbackKind.literals }).notNull(),
    /** The assistant's words: data for the admin, never instructions. */
    message: text('message').notNull(),
    /** The tool the note is about, when it names one. */
    tool: text('tool'),
    /** The UTC day it was sent, so the same note that day is one row. */
    day: text('day').notNull(),
    /** How many times it was sent that day. */
    count: integer('count').notNull(),
    status: text('status', { enum: FeedbackStatus.literals }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('assistant_feedback_once').on(table.accountId, table.day, table.kind, table.message),
    index('assistant_feedback_status_updated').on(table.status, table.updatedAt),
    index('assistant_feedback_created').on(table.createdAt),
    oneOf('assistant_feedback_kind', table.kind, FeedbackKind.literals),
    oneOf('assistant_feedback_status', table.status, FeedbackStatus.literals),
  ],
)
