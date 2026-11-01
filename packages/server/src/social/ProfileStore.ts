import { profiles } from '@styld/db'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { ProfileNotPublished, Unavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { first, query } from '../kernel/Db.ts'

export type ProfileRow = typeof profiles.$inferSelect

/** Profiles in D1, one per account. */
export const makeProfileStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return {
    findProfile: (accountId: string) =>
      query(() => db.select().from(profiles).where(eq(profiles.accountId, accountId)).limit(1)).pipe(Effect.map(first)),
    /** Whose a handle is, if anyone's. */
    handleOwner: (handle: string) =>
      query(() =>
        db.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.handle, handle)).limit(1),
      ).pipe(Effect.map((rows) => Option.map(first(rows), ({ accountId }) => accountId))),
    /** Write the profile whole. A handle someone else took meanwhile fails on its unique index. */
    saveProfile: (row: ProfileRow) => {
      const { accountId, createdAt, ...changes } = row
      return query(() =>
        db.insert(profiles).values(row).onConflictDoUpdate({ target: profiles.accountId, set: changes }).returning(),
      ).pipe(Effect.map((rows) => Option.getOrElse(first(rows), () => ({ ...row, accountId, createdAt }))))
    },
  }
}

export type ProfileStore = ReturnType<typeof makeProfileStore>

/** Boards go public and looks are shared only from a published profile. */
export const requirePublished = (store: ProfileStore, accountId: string) =>
  Effect.flatMap(store.findProfile(accountId).pipe(Effect.mapError(() => Unavailable.make({}))), (profile) =>
    Option.isSome(profile) && profile.value.published ? Effect.void : Effect.fail(ProfileNotPublished.make({})),
  )
