import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

/** A piece of clothing someone owns. Its photo lives in R2 under `accounts/<accountId>/`, so deleting
 * an account removes its photos with one prefix sweep. */
export const pieces = sqliteTable(
  'pieces',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name'),
    notes: text('notes'),
    category: text('category').notNull(),
    subcategory: text('subcategory'),
    colours: text('colours', { mode: 'json' }).notNull().$type<ReadonlyArray<string>>(),
    status: text('status', { enum: ['processing', 'ready', 'failed'] }).notNull(),
    source: text('source', { enum: ['website', 'assistant'] }).notNull(),
    /** One photo makes at most one piece, so a second add of the same upload fails as a whole. */
    uploadId: text('upload_id').notNull().unique(),
    /** The photo as it arrived; the shown image once the cutout step has run. */
    originalKey: text('original_key').notNull(),
    imageKey: text('image_key'),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('pieces_account_created').on(table.accountId, table.createdAt)],
)

/** A photo on its way in. The token that authorises the `PUT` is stored only as its digest. */
export const uploads = sqliteTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenDigest: text('token_digest').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status', { enum: ['pending', 'received', 'used'] }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('uploads_account').on(table.accountId), index('uploads_expiry').on(table.expiresAt)],
)

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
  (table) => [primaryKey({ columns: [table.accountId, table.operationId] })],
)

export const appSchema = {
  accounts,
  authAttemptBuckets,
  oauthClients,
  oauthGrants,
  oauthAssertions,
  pieces,
  uploads,
  operationReceipts,
}
