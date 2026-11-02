import { profiles } from '@styld/db'
import { ProfileNotPublished, Unavailable } from '@styld/protocol'
import { and, eq } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { type Database, first, query } from '../kernel/Db.ts'

// Profiles in D1, one per account: the only queries that read a profile by its account or a handle's owner, for every
// module that needs them. Only `Profiles` and `Curation` write the table.

export type ProfileRow = typeof profiles.$inferSelect

/** The account's profile, if it has one. */
export const profileOf = (db: Database['Service'], accountId: string) =>
  query(() => db.select().from(profiles).where(eq(profiles.accountId, accountId)).limit(1)).pipe(Effect.map(first))

/** The account behind a handle, if anyone's; `published` asks only for a published profile. */
export const handleOwner = (db: Database['Service'], handle: string, published: 'any' | 'published' = 'any') =>
  query(() =>
    db
      .select({ accountId: profiles.accountId })
      .from(profiles)
      .where(and(eq(profiles.handle, handle), published === 'published' ? eq(profiles.published, true) : undefined))
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
