import { accounts, authMirror } from '@styld/db'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { AppAuth, emailCredentials } from './storage.ts'

// An account the person has not made yet, made for them the way email-code registration makes one (EmailPersistence.ts
// `makeRegistrationMapping`): the enabled account, its verified `email` identifier, the authority credential and the
// email credential bound to it, and no password. Signing in later with the usual code lands in it. Used by the v1
// importer at the switch, so a wardrobe can be brought over before its owner signs in.

type Database = ReturnType<typeof drizzle>

const { identifiers, credentials } = authMirror

/** The email module's id: the namespace Yielded's code sign-in and registration are bound to. */
const emailModuleId = AppAuth.strategies.email.moduleId

/** An address as the sign-in form decodes it: trimmed and lower-cased. */
const normalized = (email: string) => email.trim().toLowerCase()

/** An active, verified email identifier of an enabled account. */
const verifiedEmailOfEnabled = and(
  eq(identifiers.namespace, 'email'),
  eq(identifiers.active, true),
  isNotNull(identifiers.verifiedAt),
  eq(accounts.enabled, true),
)

/** The enabled account a verified email signs in to, as a query for its id. */
export const accountOfEmail = (db: Database, email: string) =>
  db
    .select({ accountId: accounts.id })
    .from(identifiers)
    .innerJoin(accounts, eq(accounts.id, identifiers.subjectId))
    .where(and(eq(identifiers.value, normalized(email)), verifiedEmailOfEnabled))
    .limit(1)

/** The verified address an enabled account signs in with, as a query. */
export const emailOfAccount = (db: Database, accountId: string) =>
  db
    .select({ email: identifiers.value })
    .from(identifiers)
    .innerJoin(accounts, eq(accounts.id, identifiers.subjectId))
    .where(and(eq(identifiers.subjectId, accountId), verifiedEmailOfEnabled))
    .limit(1)

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
    db.insert(identifiers).values({
      namespace: 'email',
      value: email,
      subjectId: account.accountId,
      revision: account.bindingRevision,
      verifiedAt: account.at.getTime(),
      active: true,
    }),
    db.insert(credentials).values({
      credentialId: account.credentialId,
      subjectId: account.accountId,
      revision: account.credentialRevision,
      active: true,
    }),
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
