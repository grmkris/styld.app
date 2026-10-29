import { authTables } from '@styld/auth'
import { accounts, oauthGrants } from '@styld/db'
import { AccountUnavailable } from '@styld/protocol'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { Context, Effect } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as Base64Url from 'effect/encoding/Base64Url'
import { accountPrefix } from './wardrobe/Media.ts'
import type { WardrobeBindings } from './wardrobe/Wardrobe.ts'

const unavailable = () => AccountUnavailable.make({})

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: unavailable })

/** R2 deletes at most this many keys per call. */
const deleteBatch = 1000

const make = (bindings: Pick<WardrobeBindings, 'database' | 'bucket'>) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const db = drizzle(bindings.database)
    // The managed auth tables are typed generically, so their subject column is named in SQL.
    const ofSubject = (table: SQLiteTable, accountId: string) =>
      db.run(sql`delete from ${table} where ${sql.identifier('subject_id')} = ${accountId}`)

    /** Delete every photo under the account's prefix, a page at a time. */
    const sweepPhotos = Effect.fnUntraced(function* (accountId: string) {
      let cursor: string | undefined
      do {
        const page = yield* attempt(() =>
          bindings.bucket.list({
            prefix: accountPrefix(accountId),
            limit: deleteBatch,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        )
        const keys = page.objects.map(({ key }) => key)
        if (keys.length > 0) yield* attempt(() => bindings.bucket.delete(keys))
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor !== undefined)
    })

    /** Delete an account and everything it owns. Access ends first (disabled, a new security
     * revision, no sessions, no assistant grants), so a failure later leaves a closed account a
     * retry finishes; photos go next, then the auth rows and the account, whose pieces, uploads
     * and receipts cascade with it. */
    const deleteAccount = Effect.fn('Styld.Account.delete')(function* (accountId: string) {
      const revision = Base64Url.encode(yield* crypto.randomBytes(16).pipe(Effect.mapError(unavailable)))
      yield* attempt(() =>
        db.batch([
          db.update(accounts).set({ enabled: false, securityRevision: revision }).where(eq(accounts.id, accountId)),
          ofSubject(authTables.sessions, accountId),
          db.delete(oauthGrants).where(eq(oauthGrants.subjectId, accountId)),
        ]),
      )
      yield* sweepPhotos(accountId)
      yield* attempt(() =>
        db.batch([
          ofSubject(authTables.pending, accountId),
          ofSubject(authTables.emailCredentials, accountId),
          ofSubject(authTables.passwords, accountId),
          ofSubject(authTables.credentials, accountId),
          ofSubject(authTables.identifiers, accountId),
          db.delete(accounts).where(eq(accounts.id, accountId)),
        ]),
      )
    })

    return { deleteAccount }
  })

/** Account termination, owned by the application: Yielded's `SubjectLifecycle` leaves it to us. */
export class AccountLifecycle extends Context.Service<AccountLifecycle, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/AccountLifecycle',
) {}

export const makeAccountLifecycle = (bindings: Pick<WardrobeBindings, 'database' | 'bucket'>) =>
  Effect.map(make(bindings), (service) => AccountLifecycle.of(service))
