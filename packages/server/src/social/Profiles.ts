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
import { type Operation, recorded } from '../kernel/Receipts.ts'
import { handleOwner, profileOf, type ProfileRow, profileWrite } from './ProfileStore.ts'

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

/** A profile write that did not land: a handle taken between the check and the write is still taken. */
const lostWrite = (db: Database['Service'], accountId: string, handle: Handle | undefined) =>
  handle === undefined
    ? Effect.fail(unavailable())
    : Effect.flatMap(stored(handleOwner(db, handle)), (owner) =>
        Effect.fail(Option.isSome(owner) && owner.value !== accountId ? HandleTaken.make({}) : unavailable()),
      )

const make = Effect.gen(function* () {
  const db = yield* Database
  const checks = yield* Checks
  /** The profile as an operation on it answers, first time or repeated: as it is now. A published profile is checked
   * as it is now; its pieces are checked with the boards and looks that show them. */
  const answered = (accountId: string) =>
    Effect.gen(function* () {
      const row = yield* current(db, accountId)
      const target = { kind: 'profile' as const, id: accountId }
      if (!row.published) return shown(row, yield* checks.status(target))
      return shown(row, yield* checks.checkNow(target))
    })
  /** The profile written whole under the operation: once, its receipt in the same batch (`recorded`). */
  const written = <E>(accountId: string, operation: Omit<Operation, 'accountId'>, next: Effect.Effect<ProfileRow, E>) =>
    recorded(
      db,
      { ...operation, accountId },
      {
        write: Effect.map(next, (row) => ({ statements: [profileWrite(db, row)], result: accountId })),
        answer: () => answered(accountId),
      },
    )
  return {
    getProfile: Effect.fn('Styld.Profiles.get')(function* () {
      const { accountId } = yield* CurrentAccount
      return shown(yield* current(db, accountId), yield* checks.status({ kind: 'profile', id: accountId }))
    }),
    /** Change the profile; a new handle must be free and not reserved. */
    updateProfile: Effect.fn('Styld.Profiles.update')(function* (input: UpdateProfile) {
      const { accountId } = yield* CurrentAccount
      const { operationId, ...changes } = input
      const next = Effect.gen(function* () {
        const before = yield* current(db, accountId)
        if (changes.handle !== undefined && changes.handle !== before.handle)
          yield* claimable(db, accountId, changes.handle)
        const row = { ...before, ...changes, updatedAt: yield* nowDate }
        return { ...row, searchText: searchText(row.name, row.handle) }
      })
      return yield* written(accountId, { operationId, command: 'updateProfile', input: changes }, next).pipe(
        Effect.catchTag('Unavailable', () => lostWrite(db, accountId, changes.handle)),
      )
    }),
    /** Publish the profile, which needs a handle, or take it down. Publishing keeps the handle, so it cannot be taken
     * meanwhile; a failed write is only unavailable. */
    publishProfile: Effect.fn('Styld.Profiles.publish')(function* (input: PublishProfile) {
      const { accountId } = yield* CurrentAccount
      const { operationId, published } = input
      const next = Effect.gen(function* () {
        const before = yield* current(db, accountId)
        if (published && before.handle === null) return yield* ProfileNeedsHandle.make({})
        const at = yield* nowDate
        // A profile published without a name goes by its handle.
        const name = before.name.trim().length === 0 && before.handle !== null ? before.handle : before.name
        return {
          ...before,
          name,
          searchText: searchText(name, before.handle),
          published,
          publishedAt: published && !before.published ? at : before.publishedAt,
          updatedAt: at,
        }
      })
      return yield* written(accountId, { operationId, command: 'publishProfile', input: published }, next)
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
