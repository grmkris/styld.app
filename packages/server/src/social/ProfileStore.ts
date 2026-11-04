import { accounts, profiles, profileTranslations } from '@styld/db'
import { ProfileNotPublished, Unavailable } from '@styld/protocol'
import { and, eq, exists } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { type Database, first, query } from '../kernel/Db.ts'

// Profiles in D1, one per account: the only queries that read a profile by its account or a handle's owner, for every
// module that needs them. Only `Profiles` and `Curation` write the table.

export type ProfileRow = typeof profiles.$inferSelect

/** The profile's account is open. An account being deleted is closed from the moment deletion begins, so its profile,
 * and with it everything it shows others, is read by nobody while its rows are purged. */
const accountOpen = (db: Database['Service']) =>
  exists(
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, profiles.accountId), eq(accounts.enabled, true))),
  )

/** A profile others may be shown: published, of an open account. */
export const shownToOthers = (db: Database['Service']) => and(eq(profiles.published, true), accountOpen(db))

/** The account's profile, if it has one and the account is open. */
export const profileOf = (db: Database['Service'], accountId: string) =>
  query(() =>
    db
      .select()
      .from(profiles)
      .where(and(eq(profiles.accountId, accountId), accountOpen(db)))
      .limit(1),
  ).pipe(Effect.map(first))

/** The account behind a handle, if anyone's; `published` asks only for a profile others may be shown. */
export const handleOwner = (db: Database['Service'], handle: string, published: 'any' | 'published' = 'any') =>
  query(() =>
    db
      .select({ accountId: profiles.accountId })
      .from(profiles)
      .where(and(eq(profiles.handle, handle), published === 'published' ? shownToOthers(db) : undefined))
      .limit(1),
  ).pipe(Effect.map((rows) => Option.map(first(rows), ({ accountId }) => accountId)))

/** The statement that writes the profile whole, for its operation's batch. A handle someone else took meanwhile fails
 * on its unique index. */
export const profileWrite = (db: Database['Service'], row: ProfileRow) => {
  const { accountId: _accountId, createdAt: _createdAt, ...changes } = row
  return db.insert(profiles).values(row).onConflictDoUpdate({ target: profiles.accountId, set: changes })
}

/** Boards go public and looks are shared only from a published profile. */
export const requirePublished = (db: Database['Service'], accountId: string) =>
  Effect.flatMap(profileOf(db, accountId).pipe(Effect.mapError(() => Unavailable.make({}))), (profile) =>
    Option.isSome(profile) && profile.value.published ? Effect.void : Effect.fail(ProfileNotPublished.make({})),
  )

/** A profile's name and bio in another language, as the profiles' module keeps it (the house profiles, owner
 * 4 November 2026), for the seed's batch. */
export const profileTranslationWrite = (db: Database['Service'], row: typeof profileTranslations.$inferInsert) =>
  db
    .insert(profileTranslations)
    .values(row)
    .onConflictDoUpdate({
      target: [profileTranslations.accountId, profileTranslations.locale],
      set: {
        name: row.name,
        bio: row.bio,
        sourceDigest: row.sourceDigest,
        review: row.review,
        updatedAt: row.updatedAt,
      },
    })
