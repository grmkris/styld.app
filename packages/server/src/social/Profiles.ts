import {
  type Handle,
  HandleReserved,
  HandleTaken,
  Profile,
  ProfileNeedsHandle,
  type PublishProfile,
  reservedHandles,
  searchText,
  Tone,
  type UpdateProfile,
  WardrobeUnavailable,
} from '@styld/protocol'
import { Context, DateTime, Effect, Option, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { StoreUnavailable } from '../wardrobe/Store.ts'
import { makeProfileStore, type ProfileRow, type ProfileStore } from './ProfileStore.ts'

const unavailable = () => WardrobeUnavailable.make({})
const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)
const nowDate = Effect.map(DateTime.now, DateTime.toDateUtc)

/** A tone that stays the same for an account until the person picks another. */
const toneFor = (accountId: string): Tone => {
  let hash = 0
  for (const character of accountId) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003
  return Tone.literals[hash % Tone.literals.length] ?? 'sand'
}

/** A profile as the protocol shows it. */
const shown = (row: ProfileRow): Profile =>
  // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
  Schema.decodeUnknownSync(Profile)({
    handle: row.handle,
    name: row.name,
    city: row.city,
    bio: row.bio,
    tone: row.tone,
    published: row.published,
    wardrobeShown: row.wardrobeShown,
  })

/** The account's profile as stored, or the one it would have: its signup name, unpublished, wardrobe shown. */
const current = (store: ProfileStore, accountId: string) =>
  Effect.gen(function* () {
    const row = yield* stored(store.findProfile(accountId))
    if (Option.isSome(row)) return row.value
    const name = Option.getOrElse(yield* stored(store.displayName(accountId)), () => 'Styld')
    const at = yield* nowDate
    const fresh: ProfileRow = {
      accountId,
      handle: null,
      name,
      city: null,
      bio: null,
      tone: toneFor(accountId),
      published: false,
      publishedAt: null,
      wardrobeShown: true,
      house: false,
      featuredAt: null,
      searchText: searchText(name),
      createdAt: at,
      updatedAt: at,
    }
    return fresh
  })

/** A handle the account may take: not reserved, and nobody else's. */
const claimable = (store: ProfileStore, accountId: string, handle: Handle) =>
  Effect.gen(function* () {
    if (reservedHandles.has(handle)) return yield* HandleReserved.make({})
    const owner = yield* stored(store.handleOwner(handle))
    if (Option.isSome(owner) && owner.value !== accountId) return yield* HandleTaken.make({})
  })

/** Save a profile; a handle taken between the check and the write is still taken. */
const saved = (store: ProfileStore, row: ProfileRow) =>
  store
    .saveProfile(row)
    .pipe(
      Effect.catchTag('StoreUnavailable', () =>
        Effect.flatMap(stored(store.handleOwner(row.handle ?? '')), (owner) =>
          Effect.fail(Option.isSome(owner) && owner.value !== row.accountId ? HandleTaken.make({}) : unavailable()),
        ),
      ),
    )

const make = (database: Parameters<typeof makeProfileStore>[0]) => {
  const store = makeProfileStore(database)
  return {
    getProfile: Effect.fn('Styld.Profiles.get')(function* () {
      const { accountId } = yield* CurrentAccount
      return shown(yield* current(store, accountId))
    }),
    /** Change the profile; a new handle must be free and not reserved. */
    updateProfile: Effect.fn('Styld.Profiles.update')(function* (input: UpdateProfile) {
      const { accountId } = yield* CurrentAccount
      const before = yield* current(store, accountId)
      if (input.handle !== undefined && input.handle !== before.handle) yield* claimable(store, accountId, input.handle)
      const next = { ...before, ...input, updatedAt: yield* nowDate }
      return shown(yield* saved(store, { ...next, searchText: searchText(next.name, next.handle) }))
    }),
    /** Publish the profile, which needs a handle, or take it down. */
    publishProfile: Effect.fn('Styld.Profiles.publish')(function* (input: PublishProfile) {
      const { accountId } = yield* CurrentAccount
      const before = yield* current(store, accountId)
      if (input.published && before.handle === null) return yield* ProfileNeedsHandle.make({})
      const at = yield* nowDate
      const publishedAt = input.published && !before.published ? at : before.publishedAt
      // Publishing keeps the handle, so it cannot be taken meanwhile; a failed write is only unavailable.
      const row = yield* saved(store, { ...before, published: input.published, publishedAt, updatedAt: at }).pipe(
        Effect.catchTag('HandleTaken', () => Effect.fail(unavailable())),
      )
      return shown(row)
    }),
  }
}

/** Profiles: the person's public face. Every operation acts for `CurrentAccount`. */
export class Profiles extends Context.Service<Profiles, ReturnType<typeof make>>()('@styld/server/Profiles') {}

/** Profiles over the Worker's database. Build it once per isolate. */
export const makeProfiles = (database: Parameters<typeof makeProfileStore>[0]) => Profiles.of(make(database))
