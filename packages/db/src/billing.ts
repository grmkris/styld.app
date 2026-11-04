import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { planNames } from '@styld/protocol'
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
    /** What the payment bought: a week or lifetime (a subscription's payments are its own events', not rows here). */
    plan: text('plan', { enum: planNames }).notNull().default('week'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('purchases_account').on(table.accountId),
    oneOf('purchases_status', table.status, purchaseStatuses),
  ],
)

/** Where a membership stands: running (a subscription renews), cancelled (it ends at `until` and does not renew), or
 * ended at once (expired, failed, on hold, or taken back). */
export const membershipStatuses = ['active', 'cancelled', 'ended'] as const

/** An account's plan (owner, 4 November 2026): the one record of whether it has the members' daily allowance, written
 * only by Dodo's webhook and the operator's grant (`server/src/billing/`). `until` is the end, none for lifetime; the
 * Wallet is told the allowance with each reservation and never stores the end. Gone with the account. */
export const memberships = sqliteTable(
  'memberships',
  {
    accountId: text('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    plan: text('plan', { enum: planNames }).notNull(),
    /** When the members' allowance ends; none for lifetime. */
    until: integer('until', { mode: 'timestamp_ms' }),
    status: text('status', { enum: membershipStatuses }).notNull(),
    /** Dodo's subscription, for monthly and yearly. */
    subscriptionId: text('subscription_id'),
    /** Dodo's customer, for the customer portal. */
    customerId: text('customer_id'),
    /** When the last subscription event applied happened, Dodo's own time: an older one delivered late is left alone. */
    subscriptionEventAt: integer('subscription_event_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('memberships_subscription').on(table.subscriptionId),
    oneOf('memberships_plan', table.plan, planNames),
    oneOf('memberships_status', table.status, membershipStatuses),
  ],
)
