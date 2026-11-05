import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Yielded Auth's managed tables (`@styld/auth/storage`) are typed as a generic SQLiteTable, so their columns cannot be
// named through Drizzle. These mirrors declare the same tables, column for column, so Styld's own reads and deletes of
// auth rows use typed columns. They are not schema: Drizzle Kit reads the managed tables from `@styld/auth/storage` and
// never these (`drizzle.config.ts`), and `packages/auth/test/AuthMirror.test.ts` fails when Yielded's columns drift.

const identifiers = sqliteTable('styld_auth_identifiers', {
  namespace: text('namespace').notNull(),
  value: text('value').notNull(),
  moduleId: text('module_id'),
  credentialId: text('credential_id'),
  subjectId: text('subject_id').notNull(),
  revision: text('revision').notNull(),
  /** Epoch milliseconds, as Yielded's engine clock writes them. */
  verifiedAt: integer('verified_at'),
  active: integer('active', { mode: 'boolean' }).notNull(),
})

const credentials = sqliteTable('styld_auth_credentials', {
  credentialId: text('credential_id').notNull(),
  subjectId: text('subject_id').notNull(),
  revision: text('revision').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
})

const passwords = sqliteTable('styld_auth_passwords', {
  moduleId: text('module_id').notNull(),
  subjectId: text('subject_id').notNull(),
  credentialId: text('credential_id').notNull(),
  credentialRevision: text('credential_revision').notNull(),
  verifierVersion: text('verifier_version').notNull(),
  verifier: text('verifier').notNull(),
  normalization: text('normalization').notNull(),
})

const sessions = sqliteTable('styld_auth_sessions', {
  sessionId: text('session_id').notNull(),
  subjectId: text('subject_id').notNull(),
  digest: text('digest').notNull(),
  securityRevision: text('security_revision').notNull(),
  issuedAt: integer('issued_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  absoluteExpiresAt: integer('absolute_expires_at').notNull(),
  record: text('record').notNull(),
})

const pending = sqliteTable('styld_auth_pending', {
  moduleId: text('module_id').notNull(),
  kind: text('kind').notNull(),
  digest: text('digest').notNull(),
  version: text('version').notNull(),
  flowId: text('flow_id').notNull(),
  subjectId: text('subject_id').notNull(),
  bindingDigest: text('binding_digest').notNull(),
  snapshot: text('snapshot').notNull(),
  expiresAt: integer('expires_at').notNull(),
  attemptLimit: integer('attempt_limit').notNull(),
  failedAttempts: integer('failed_attempts').notNull(),
  consumed: integer('consumed', { mode: 'boolean' }).notNull(),
})

const oauthIdentities = sqliteTable('styld_auth_oauthIdentities', {
  identityKey: text('identity_key').notNull(),
  provider: text('provider').notNull(),
  issuer: text('issuer').notNull(),
  externalSubject: text('external_subject').notNull(),
  subjectId: text('subject_id').notNull(),
})

const oauthCredentials = sqliteTable('styld_auth_oauthCredentials', {
  moduleId: text('module_id').notNull(),
  credentialId: text('credential_id').notNull(),
  subjectId: text('subject_id').notNull(),
  identityKey: text('identity_key').notNull(),
  credentialRevision: text('credential_revision').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
})

const oauthSignInFlows = sqliteTable('styld_auth_oauthSignInFlows', {
  moduleId: text('module_id').notNull(),
  flowId: text('flow_id').notNull(),
  purpose: text('purpose').notNull(),
  generation: integer('generation').notNull(),
  provider: text('provider').notNull(),
  callbackId: text('callback_id').notNull(),
  issuer: text('issuer').notNull(),
  responseIssuerMode: text('response_issuer_mode').notNull(),
  subjectId: text('subject_id'),
  stateDigest: text('state_digest').notNull(),
  binderVerifier: text('binder_verifier').notNull(),
  binderExpiresAt: integer('binder_expires_at').notNull(),
  snapshot: text('snapshot').notNull(),
  issuedAt: integer('issued_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

/** Typed mirrors of Yielded Auth's managed tables, keyed as `@styld/auth/storage` names them. */
export const authMirror = {
  identifiers,
  credentials,
  passwords,
  sessions,
  pending,
  oauthIdentities,
  oauthCredentials,
  oauthSignInFlows,
}
