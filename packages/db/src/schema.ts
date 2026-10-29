import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  securityRevision: text('security_revision').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const authAttemptBuckets = sqliteTable(
  'auth_attempt_buckets',
  {
    key: text('key').primaryKey().notNull(),
    tokens: real('tokens').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('auth_attempt_buckets_expiry').on(table.expiresAt)],
)

/** MCP clients registered dynamically (RFC 7591): public clients only, with exact redirect URIs. */
export const oauthClients = sqliteTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
  applicationType: text('application_type', { enum: ['web', 'native'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

/** The OAuth server's grant records, compared and replaced by version. */
export const oauthGrants = sqliteTable(
  'oauth_grants',
  {
    namespace: text('namespace').notNull(),
    id: text('id').notNull(),
    version: text('version').notNull(),
    record: text('record').notNull(),
    subjectId: text('subject_id'),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.namespace, table.id] }),
    index('oauth_grants_subject').on(table.subjectId),
    index('oauth_grants_expiry').on(table.expiresAt),
  ],
)

/** Client assertion receipts, each consumable once until it expires. */
export const oauthAssertions = sqliteTable(
  'oauth_assertions',
  {
    namespace: text('namespace').notNull(),
    receipt: text('receipt').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.namespace, table.receipt] })],
)

export const appSchema = { accounts, authAttemptBuckets, oauthClients, oauthGrants, oauthAssertions }
