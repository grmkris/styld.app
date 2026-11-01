import {
  type CheckStatus,
  CurrentAccount,
  type Handle,
  HandleReserved,
  HandleTaken,
  Profile,
  ProfileNeedsHandle,
  type PublishProfile,
  reservedHandles,
  searchText,
  Tone,
  Unavailable,
  type UpdateProfile,
} from '@styld/protocol'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { Checks } from '../safety/Checks.ts'
import { Database, nowDate, type StoreUnavailable } from '../kernel/Db.ts'
import { handleOwner, profileOf, type ProfileRow, saveProfile } from './ProfileStore.ts'

const unavailable = () => Unavailable.make({})
const stored = <A>(effect: Effect.Effect<A, StoreUnavailable>) => Effect.mapError(effect, unavailable)

/** A tone that stays the same for an account until the person picks another. */
const toneFor = (accountId: string): Tone => {
  let hash = 0
  for (const character of accountId) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003
  return Tone.literals[hash % Tone.literals.length] ?? 'sand'
}

/** A profile as the protocol shows it. */
const shown = (row: ProfileRow, check: Option.Option<CheckStatus>): Profile =>
  // Only the service writes rows, through the same schemas; a row that does not decode is a bug.
  Schema.decodeUnknownSync(Profile)({
    handle: row.handle,
    name: row.name,
    city: row.city,
    bio: row.bio,
    tone: row.tone,
    published: row.published,
    check: Option.getOrNull(check),
  })

/** The account's profile as stored, or the one it would have: no name yet, unpublished. A signup name
 * can be the start of an email address, so it never becomes a public name by default. */
const current = (db: Database['Service'], accountId: string) =>
  Effect.gen(function* () {
    const row = yield* stored(profileOf(db, accountId))
    if (Option.isSome(row)) return row.value
    const at = yield* nowDate
    const fresh: ProfileRow = {
      accountId,
      handle: null,
      name: '',
      city: null,
      bio: null,
      tone: toneFor(accountId),
      published: false,
      publishedAt: null,
      house: false,
      featuredAt: null,
      searchText: searchText(''),
      createdAt: at,
      updatedAt: at,
    }
    return fresh
  })

/** A handle the account may take: not reserved, and nobody else's. */
const claimable = (db: Database['Service'], accountId: string, handle: Handle) =>
  Effect.gen(function* () {
    if (reservedHandles.has(handle)) return yield* HandleReserved.make({})
    const owner = yield* stored(handleOwner(db, handle))
    if (Option.isSome(owner) && owner.value !== accountId) return yield* HandleTaken.make({})
  })

/** Save a profile; a handle taken between the check and the write is still taken. */
const saved = (db: Database['Service'], row: ProfileRow) =>
  saveProfile(db, row).pipe(
    Effect.catchTag('StoreUnavailable', () =>
      Effect.flatMap(stored(handleOwner(db, row.handle ?? '')), (owner) =>
        Effect.fail(Option.isSome(owner) && owner.value !== row.accountId ? HandleTaken.make({}) : unavailable()),
      ),
    ),
  )

const make = Effect.gen(function* () {
  const db = yield* Database
  const checks = yield* Checks
  /** A published profile is checked as it is now. Its pieces are checked with the boards and looks that show them. */
  const checked = (row: ProfileRow) =>
    Effect.gen(function* () {
      const target = { kind: 'profile' as const, id: row.accountId }
      if (!row.published) return shown(row, yield* checks.status(target))
      return shown(row, yield* checks.checkNow(target))
    })
  return {
    getProfile: Effect.fn('Styld.Profiles.get')(function* () {
      const { accountId } = yield* CurrentAccount
      return shown(yield* current(db, accountId), yield* checks.status({ kind: 'profile', id: accountId }))
    }),
    /** Change the profile; a new handle must be free and not reserved. */
    updateProfile: Effect.fn('Styld.Profiles.update')(function* (input: UpdateProfile) {
      const { accountId } = yield* CurrentAccount
      const before = yield* current(db, accountId)
      if (input.handle !== undefined && input.handle !== before.handle) yield* claimable(db, accountId, input.handle)
      // Setting fields is the same change however often it is sent, so the operation id needs no receipt.
      const { operationId: _operationId, ...changes } = input
      const next = { ...before, ...changes, updatedAt: yield* nowDate }
      const row = yield* saved(db, { ...next, searchText: searchText(next.name, next.handle) })
      return yield* checked(row)
    }),
    /** Publish the profile, which needs a handle, or take it down. */
    publishProfile: Effect.fn('Styld.Profiles.publish')(function* (input: PublishProfile) {
      const { accountId } = yield* CurrentAccount
      const before = yield* current(db, accountId)
      if (input.published && before.handle === null) return yield* ProfileNeedsHandle.make({})
      const at = yield* nowDate
      const publishedAt = input.published && !before.published ? at : before.publishedAt
      // A profile published without a name goes by its handle.
      const name = before.name.trim().length === 0 && before.handle !== null ? before.handle : before.name
      // Publishing keeps the handle, so it cannot be taken meanwhile; a failed write is only unavailable.
      const row = yield* saved(db, {
        ...before,
        name,
        searchText: searchText(name, before.handle),
        published: input.published,
        publishedAt,
        updatedAt: at,
      }).pipe(Effect.catchTag('HandleTaken', () => Effect.fail(unavailable())))
      return yield* checked(row)
    }),
  }
})

/** Profiles: the person's public face. Every operation acts for `CurrentAccount`. */
export class Profiles extends Context.Service<Profiles, Effect.Success<typeof make>>()(
  '@styld/server/social/Profiles',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Profiles.of(service)),
  )
}
