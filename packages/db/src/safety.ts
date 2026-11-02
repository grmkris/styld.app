import { CheckReason, CheckState } from '@styld/protocol'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { oneOf } from './checks.ts'
import { accounts } from './identity.ts'

// Safety: the model's checks of what people make public. A check names its target by kind and id rather than by a
// foreign key, since it covers five tables; the checks sweep forgets a check whose target is gone.

const checkTargets = ['profile', 'board', 'piece', 'picture', 'look'] as const
const hiddenBy = ['reports', 'admin'] as const

/** The model's check of something public: the digest of what it read, and what it answered. The operation that
 * changes the content writes `pending` with the new digest; an answer lands only on the digest it read. */
export const contentChecks = sqliteTable(
  'content_checks',
  {
    targetKind: text('target_kind', { enum: checkTargets }).notNull(),
    targetId: text('target_id').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    digest: text('digest').notNull(),
    state: text('state', { enum: CheckState.literals }).notNull(),
    reason: text('reason', { enum: CheckReason.literals }),
    /** Which judge answered (for the admins' list of checks). */
    model: text('model'),
    /** Hidden by reports or by an admin, whatever the model said. */
    hidden: text('hidden', { enum: hiddenBy }),
    requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.targetKind, table.targetId] }),
    index('content_checks_state').on(table.state, table.requestedAt),
    index('content_checks_account').on(table.accountId),
    oneOf('content_checks_target_kind', table.targetKind, checkTargets),
    oneOf('content_checks_state_value', table.state, CheckState.literals),
    oneOf('content_checks_reason', table.reason, CheckReason.literals),
    oneOf('content_checks_hidden', table.hidden, hiddenBy),
  ],
)
