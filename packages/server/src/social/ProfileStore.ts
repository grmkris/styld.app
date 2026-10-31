import { pieces, profiles } from '@styld/db'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { ProfileNotPublished, WardrobeUnavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { StoreUnavailable } from '../wardrobe/Store.ts'

export type ProfileRow = typeof profiles.$inferSelect

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => StoreUnavailable.make({}) })
const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0])

/** Profiles in D1, one per account. */
export const makeProfileStore = (database: Parameters<typeof drizzle>[0]) => {
  const db = drizzle(database)
  return {
    findProfile: (accountId: string) =>
      attempt(() => db.select().from(profiles).where(eq(profiles.accountId, accountId)).limit(1)).pipe(
        Effect.map(first),
      ),
    /** Whose a handle is, if anyone's. */
    handleOwner: (handle: string) =>
      attempt(() =>
        db.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.handle, handle)).limit(1),
      ).pipe(Effect.map((rows) => Option.map(first(rows), ({ accountId }) => accountId))),
    /** The account's ready pieces, which a shown wardrobe puts on the profile. */
    readyPieceIds: (accountId: string) =>
      attempt(() =>
        db
          .select({ id: pieces.id })
          .from(pieces)
          .where(and(eq(pieces.accountId, accountId), eq(pieces.status, 'ready'))),
      ).pipe(Effect.map((rows) => rows.map(({ id }) => id))),
    /** Write the profile whole. A handle someone else took meanwhile fails on its unique index. */
    saveProfile: (row: ProfileRow) => {
      const { accountId, createdAt, ...changes } = row
      return attempt(() =>
        db.insert(profiles).values(row).onConflictDoUpdate({ target: profiles.accountId, set: changes }).returning(),
      ).pipe(Effect.map((rows) => Option.getOrElse(first(rows), () => ({ ...row, accountId, createdAt }))))
    },
  }
}

export type ProfileStore = ReturnType<typeof makeProfileStore>

/** Boards go public and looks are shared only from a published profile. */
export const requirePublished = (store: ProfileStore, accountId: string) =>
  Effect.flatMap(store.findProfile(accountId).pipe(Effect.mapError(() => WardrobeUnavailable.make({}))), (profile) =>
    Option.isSome(profile) && profile.value.published ? Effect.void : Effect.fail(ProfileNotPublished.make({})),
  )
