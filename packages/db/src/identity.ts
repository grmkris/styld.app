import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { oneOf } from './checks.ts'

// Who someone is: the account Yielded Auth signs in (its identifiers, credentials and sessions are in
// `@styld/auth/storage`), the sign-in attempt limiter, and the MCP OAuth server's clients, grants and assertions.

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  securityRevision: text('security_revision').notNull(),
  displayName: text('display_name').notNull(),
  // A runtime default, not a column default: email registration inserts the account through a
  // synchronous Yielded mapping callback that cannot read Effect's Clock.
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** The sign-in attempt limiter's token buckets (`@styld/auth` AttemptLimiter), swept once expired. */
export const authAttemptBuckets = sqliteTable(
  'auth_attempt_buckets',
  {
    key: text('key').primaryKey(),
    tokens: real('tokens').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('auth_attempt_buckets_expiry').on(table.expiresAt)],
)

const applicationTypes = ['web', 'native'] as const

/** MCP clients registered dynamically (RFC 7591): public clients only, with exact redirect URIs. */
export const oauthClients = sqliteTable(
  'oauth_clients',
  {
    clientId: text('client_id').primaryKey(),
    name: text('name').notNull(),
    redirectUris: text('redirect_uris', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    applicationType: text('application_type', { enum: applicationTypes }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [oneOf('oauth_clients_application_type', table.applicationType, applicationTypes)],
)

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
  (table) => [
    primaryKey({ columns: [table.namespace, table.receipt] }),
    index('oauth_assertions_expiry').on(table.expiresAt),
  ],
)
