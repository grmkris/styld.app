import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { oneOf } from './checks.ts'
import { accounts } from './identity.ts'

// Payments (`server/src/billing/`): Dodo Payments is the merchant of record; D1 keeps what each payment gave, written
// only by its webhook.

/** Where a payment stands: paid, given back, or lost to a dispute. */
export const purchaseStatuses = ['succeeded', 'refunded', 'disputed'] as const

/** One payment Dodo confirmed, keyed by Dodo's payment id: the webhook's receipt (a payment delivered twice is one row)
 * and its audit trail. Gone with the account. */
export const purchases = sqliteTable(
  'purchases',
  {
    paymentId: text('payment_id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    /** In the currency's smallest unit, as Dodo reports it. */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    status: text('status', { enum: purchaseStatuses }).notNull(),
    /** The account's premium end once this payment was counted. */
    premiumUntilAfter: integer('premium_until_after', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('purchases_account').on(table.accountId),
    oneOf('purchases_status', table.status, purchaseStatuses),
  ],
)

/** Until when an account has the premium daily allowance: the one record of it, written only with a purchase's change
 * (the Wallet is told the allowance with each reservation and never stores the end). Gone with the account. */
export const premium = sqliteTable('premium', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  until: integer('until', { mode: 'timestamp_ms' }).notNull(),
})
