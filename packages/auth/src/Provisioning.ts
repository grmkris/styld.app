import { accounts } from '@styld/db'
import { sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { AppAuth, credentials, emailCredentials, identifiers } from './storage.ts'

// An account the person has not made yet, made for them the way email-code registration makes one (EmailPersistence.ts
// `makeRegistrationMapping`): the enabled account, its verified `email` identifier, the authority credential and the
// email credential bound to it, and no password. Signing in later with the usual code lands in it. Used by the v1
// importer at the switch, so a wardrobe can be brought over before its owner signs in.

type Database = ReturnType<typeof drizzle>

/** The email module's id: the namespace Yielded's code sign-in and registration are bound to. */
const emailModuleId = AppAuth.strategies.email.moduleId

/** An address as the sign-in form decodes it: trimmed and lower-cased. */
const normalized = (email: string) => email.trim().toLowerCase()

/** The enabled account a verified email signs in to, as a query for its id. */
export const accountOfEmail = (db: Database, email: string) =>
  // The managed identifier table is typed generically, so its columns are named in SQL (as EmailPersistence.ts does).
  db.all<{ readonly accountId: string }>(
    sql`select a.id as accountId from ${identifiers} i join ${accounts} a on a.id = i.subject_id
        where i.namespace = 'email' and i.value = ${normalized(email)} and i.active = 1
          and i.verified_at is not null and a.enabled = 1 limit 1`,
  )

/** The verified address an enabled account signs in with, as a query. */
export const emailOfAccount = (db: Database, accountId: string) =>
  db.all<{ readonly email: string }>(
    sql`select i.value as email from ${identifiers} i join ${accounts} a on a.id = i.subject_id
        where i.subject_id = ${accountId} and i.namespace = 'email' and i.active = 1
          and i.verified_at is not null and a.enabled = 1 limit 1`,
  )

/** What a new account is made of: its ids and revisions, random like registration's, and when its email counts as
 * verified (the operator vouches for it: it is the address the person used on v1). */
export interface NewEmailAccount {
  readonly accountId: string
  readonly credentialId: string
  readonly securityRevision: string
  readonly bindingRevision: string
  readonly credentialRevision: string
  readonly email: string
  readonly displayName: string
  readonly at: Date
}

/** The statements that make the account, for one D1 batch: an address already taken fails the batch on its unique
 * identifier, so two imports of one address make one account. */
export const createEmailAccount = (db: Database, account: NewEmailAccount) => {
  const email = normalized(account.email)
  return [
    db.insert(accounts).values({
      id: account.accountId,
      enabled: true,
      securityRevision: account.securityRevision,
      displayName: account.displayName,
      createdAt: account.at,
    }),
    db.run(
      sql`insert into ${identifiers} (namespace, value, subject_id, revision, verified_at, active)
          values ('email', ${email}, ${account.accountId}, ${account.bindingRevision}, ${account.at.getTime()}, 1)`,
    ),
    db.run(
      sql`insert into ${credentials} (credential_id, subject_id, revision, active)
          values (${account.credentialId}, ${account.accountId}, ${account.credentialRevision}, 1)`,
    ),
    db.insert(emailCredentials).values({
      moduleId: emailModuleId,
      subjectId: account.accountId,
      credentialId: account.credentialId,
      identifierNamespace: 'email',
      identifierValue: email,
      credentialRevision: account.credentialRevision,
      active: true,
    }),
  ] as const
}
