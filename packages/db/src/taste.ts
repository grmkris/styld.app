import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { jsonArray } from './checks.ts'
import { accounts } from './identity.ts'

// What the person told Styld about how they dress (owner, 4 November 2026: "Styld learns the person"). Private: never
// on a public profile, shown back in full on the Account page and removable there. What Styld works out from saves and
// worn days is read on demand, never stored (`server/src/taste/`).

/** The person's answers: the occasions they dress for, and when the first run was finished or put away. */
export const tasteAnswers = sqliteTable(
  'taste_answers',
  {
    accountId: text('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** The app's occasions they dress for, in their order; empty when none was chosen. */
    occasions: text('occasions', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    firstRunAt: integer('first_run_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [jsonArray('taste_answers_occasions', table.occasions)],
)

/** What the person asked Styld to remember ("I never wear heels"), each in their own words, written only after they
 * said yes, and removable. */
export const styleNotes = sqliteTable(
  'style_notes',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('style_notes_account_created').on(table.accountId, table.createdAt)],
)
