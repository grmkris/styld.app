import { authTables } from '@styld/auth'
import { accounts, oauthGrants } from '@styld/db'
import { NotFound, Unavailable } from '@styld/protocol'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { Context, Effect, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { accountPrefix } from './wardrobe/Media.ts'
import type { WardrobeBindings } from './wardrobe/Parts.ts'
import { deletePrefix } from './kernel/Media.ts'

const unavailable = () => Unavailable.make({})

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: unavailable })

/** The account as its owner sees it: its name and its verified email address, if it has one. */
const AccountRow = Schema.Struct({ displayName: Schema.String, email: Schema.NullOr(Schema.String) })

/** R2 deletes at most this many keys per call. */
const make = (
  bindings: Pick<WardrobeBindings, 'database' | 'bucket' | 'queue'>,
  forgetChats: (accountId: string) => Effect.Effect<void, unknown>,
) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const db = drizzle(bindings.database)
    // The managed auth tables are typed generically, so their subject column is named in SQL.
    const ofSubject = (table: SQLiteTable, accountId: string) =>
      db.run(sql`delete from ${table} where ${sql.identifier('subject_id')} = ${accountId}`)

    /** Delete every object under the account's prefix. */
    const sweepPhotos = (accountId: string) =>
      deletePrefix(bindings.bucket, accountPrefix(accountId)).pipe(
        Effect.catchTag('MediaUnavailable', () => Effect.fail(unavailable())),
      )

    /** Access ends at once: disabled, a new security revision, no sessions, no assistant grants. */
    const closeAccount = Effect.fnUntraced(function* (accountId: string) {
      const revision = Base64Url.encode(yield* crypto.randomBytes(16).pipe(Effect.mapError(unavailable)))
      yield* attempt(() =>
        db.batch([
          db.update(accounts).set({ enabled: false, securityRevision: revision }).where(eq(accounts.id, accountId)),
          ofSubject(authTables.sessions, accountId),
          db.delete(oauthGrants).where(eq(oauthGrants.subjectId, accountId)),
        ]),
      )
    })

    /** Remove what a closed account owns: photos, its chats with Styld, codes sent to its addresses, its auth rows and
     * the account (its pieces, uploads, receipts, captures, looks, boards and worn days cascade; board
     * pictures keep their upload's key under the prefix). Safe to run again; the photos are swept
     * again last, for any upload that landed meanwhile. */
    const finishDeletion = Effect.fn('Styld.Account.finishDeletion')(function* (accountId: string) {
      const addresses = yield* attempt(() =>
        db.all<{ value: string }>(
          sql`select ${sql.identifier('value')} as value from ${authTables.identifiers} where ${sql.identifier('subject_id')} = ${accountId}`,
        ),
      )
      yield* sweepPhotos(accountId)
      // The chats with Styld live in the account's own Durable Object.
      yield* forgetChats(accountId).pipe(Effect.mapError(unavailable))
      yield* attempt(() =>
        db.batch([
          ofSubject(authTables.pending, accountId),
          ofSubject(authTables.emailCredentials, accountId),
          ofSubject(authTables.passwords, accountId),
          ofSubject(authTables.credentials, accountId),
          ofSubject(authTables.identifiers, accountId),
          // Codes keep the address in their binding; they go with the account.
          ...addresses.map(({ value }) =>
            db.run(
              sql`delete from ${authTables.proofs} where json_extract(${sql.identifier('binding')}, '$.identifier.value') = ${value}`,
            ),
          ),
          db.delete(accounts).where(eq(accounts.id, accountId)),
        ]),
      )
      yield* sweepPhotos(accountId)
    })

    /** Delete an account and everything it owns. Once access has ended, the rest is queued as well
     * as tried at once: if it fails here, the queue finishes it, since the person can no longer
     * ask again. */
    const deleteAccount = Effect.fn('Styld.Account.delete')(function* (accountId: string) {
      yield* closeAccount(accountId)
      yield* attempt(() => bindings.queue.send({ _tag: 'FinishDeletion', accountId })).pipe(
        Effect.catch(() => finishDeletion(accountId)),
      )
      yield* finishDeletion(accountId).pipe(Effect.ignore)
    })

    /** The account's name and the email address it signs in with: only an active, verified email identifier. */
    const readAccount = Effect.fn('Styld.Account.read')(function* (accountId: string) {
      const rows = yield* attempt(() =>
        db.all(
          sql`select a.display_name as displayName, (select i.value from ${authTables.identifiers} i where i.subject_id = a.id and i.active = 1 and i.namespace = 'email' and i.verified_at is not null limit 1) as email from ${accounts} a where a.id = ${accountId}`,
        ),
      )
      const [row] = rows
      if (row === undefined) return yield* NotFound.make({})
      return yield* Schema.decodeUnknownEffect(AccountRow)(row).pipe(Effect.mapError(unavailable))
    })

    return { deleteAccount, finishDeletion, readAccount }
  })

/** Account termination, owned by the application: Yielded's `SubjectLifecycle` leaves it to us. */
export class AccountLifecycle extends Context.Service<AccountLifecycle, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/AccountLifecycle',
) {}

export const makeAccountLifecycle = (
  bindings: Pick<WardrobeBindings, 'database' | 'bucket' | 'queue'>,
  forgetChats: (accountId: string) => Effect.Effect<void, unknown>,
) => Effect.map(make(bindings, forgetChats), (service) => AccountLifecycle.of(service))
