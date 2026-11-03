import { authTables } from '@styld/auth/storage'
import { accountDeletions, accounts, oauthGrants } from '@styld/db'
import { CurrentAccount, NotFound, Unavailable } from '@styld/protocol'
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { Context, DateTime, Duration, Effect, Layer, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import * as Base64Url from 'effect/encoding/Base64Url'
import { forgetFilesOf } from './capture/ProviderFiles.ts'
import { GarmentSegmenter } from './capture/Providers.ts'
import { accountPrefix } from './wardrobe/Media.ts'
import { Database, nowDate } from './kernel/Db.ts'
import { deletePrefix, type Listing, Media } from './kernel/Media.ts'
import { ChatStores } from './stylist/Chats.ts'
import { PieceQueue } from './wardrobe/Processing.ts'

// Deleting an account is durable: the batch that closes access also records the deletion (`account_deletions`), and
// the record stays until every store is purged (the account's D1 rows, its objects under the prefix, its chats and its
// videos at Meta). The queue finishes it at once; the sweep finishes whatever the queue gave up on. Purged, the record
// waits for the writers admitted before deletion (a queue delivery, a provider call, an upload) to drain, purges the
// prefix and the chats a last time, and goes. From the first moment the account is closed, nothing of it is shown to
// others (`social/ProfileStore.ts`).

const unavailable = () => Unavailable.make({})

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: unavailable })

/** A deletion the queue has not finished within this is finished by the sweep. */
const queuedPatience = Duration.minutes(10)

/** How long a purged account's record waits before the last purge: every queue delivery, provider call and upload
 * admitted before deletion ends within hours. */
const drainedAfter = Duration.hours(24)

/** The most deletions one sweep finishes. */
const sweepBatch = 20

/** The account as its owner sees it: its name and its verified email address, if it has one. */
const AccountRow = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
  email: Schema.NullOr(Schema.String),
})

/** What closing an account touches: the database, the bucket its objects live in and the queue that finishes it. */
interface LifecycleBindings {
  readonly database: Database['Service']
  readonly bucket: Listing
  readonly queue: PieceQueue['Service']
}

/** The account's stores outside D1 and the bucket, each forgotten for good: its chats with Styld and its videos at
 * Meta. Safe to run again. */
interface OutsideStores {
  readonly chats: (accountId: string) => Effect.Effect<void, unknown>
  readonly providerFiles: (accountId: string) => Effect.Effect<void, unknown>
}

/** The moment `patience` ago. */
const ago = (patience: Duration.Duration) =>
  Effect.map(DateTime.now, (now) => DateTime.toDateUtc(DateTime.subtractDuration(now, patience)))

type Drizzle = Database['Service']

// The managed auth tables are typed generically, so their subject column is named in SQL.
const ofSubject = (db: Drizzle, table: SQLiteTable, accountId: string) =>
  db.run(sql`delete from ${table} where ${sql.identifier('subject_id')} = ${accountId}`)

/** Delete every object under the account's prefix. */
const sweepPhotos = (bucket: Listing, accountId: string) =>
  deletePrefix(bucket, accountPrefix(accountId)).pipe(
    Effect.catchTag('MediaUnavailable', () => Effect.fail(unavailable())),
  )

/** Every store outside D1: the objects under the prefix, the chats and the videos at Meta. */
const purgeOutside = Effect.fnUntraced(function* (bucket: Listing, outside: OutsideStores, accountId: string) {
  yield* sweepPhotos(bucket, accountId)
  yield* outside.chats(accountId).pipe(Effect.mapError(unavailable))
  yield* outside.providerFiles(accountId).pipe(Effect.mapError(unavailable))
})

/** Access ends at once, and the deletion is recorded in the same batch: disabled, a new security revision, no
 * sessions, no assistant grants. */
const closeAccount = Effect.fnUntraced(function* (db: Drizzle, accountId: string) {
  const random = yield* SecureRandom.SecureRandom
  const revision = Base64Url.encode(yield* random.randomBytes(16))
  const requestedAt = yield* nowDate
  yield* attempt(() =>
    db.batch([
      db.insert(accountDeletions).values({ accountId, requestedAt }).onConflictDoNothing(),
      db.update(accounts).set({ enabled: false, securityRevision: revision }).where(eq(accounts.id, accountId)),
      ofSubject(db, authTables.sessions, accountId),
      db.delete(oauthGrants).where(eq(oauthGrants.subjectId, accountId)),
    ]),
  )
})

/** The account's auth rows, the codes sent to its addresses and the account itself (its pieces, uploads, receipts,
 * captures, looks, boards and worn days cascade). */
const deleteRows = Effect.fnUntraced(function* (db: Drizzle, accountId: string) {
  const addresses = yield* attempt(() =>
    db.all<{ value: string }>(
      sql`select ${sql.identifier('value')} as value from ${authTables.identifiers} where ${sql.identifier('subject_id')} = ${accountId}`,
    ),
  )
  yield* attempt(() =>
    db.batch([
      ofSubject(db, authTables.pending, accountId),
      ofSubject(db, authTables.emailCredentials, accountId),
      ofSubject(db, authTables.passwords, accountId),
      ofSubject(db, authTables.credentials, accountId),
      ofSubject(db, authTables.identifiers, accountId),
      // Codes keep the address in their binding; they go with the account.
      ...addresses.map(({ value }) =>
        db.run(
          sql`delete from ${authTables.proofs} where json_extract(${sql.identifier('binding')}, '$.identifier.value') = ${value}`,
        ),
      ),
      db.delete(accounts).where(eq(accounts.id, accountId)),
    ]),
  )
})

/** The deletions the sweep moves: those still owed a purge the queue did not finish, and those drained since their
 * purge, the oldest first. */
const dueDeletions = (db: Drizzle, queued: Date, drained: Date) =>
  attempt(() =>
    db
      .select()
      .from(accountDeletions)
      .where(
        or(
          and(isNull(accountDeletions.purgedAt), lt(accountDeletions.requestedAt, queued)),
          lt(accountDeletions.purgedAt, drained),
        ),
      )
      .orderBy(asc(accountDeletions.requestedAt))
      .limit(sweepBatch),
  )

const make = (bindings: LifecycleBindings, outside: OutsideStores) =>
  Effect.gen(function* () {
    const random = yield* SecureRandom.SecureRandom
    const db = bindings.database
    const { bucket } = bindings

    /** Remove what a closed account owns, in every store, then mark its deletion purged. Safe to run again; the
     * objects are swept again last, for any upload that landed meanwhile. */
    const finishDeletion = Effect.fn('Styld.Account.finishDeletion')(function* (accountId: string) {
      yield* purgeOutside(bucket, outside, accountId)
      yield* deleteRows(db, accountId)
      yield* sweepPhotos(bucket, accountId)
      const purgedAt = yield* nowDate
      yield* attempt(() =>
        db.update(accountDeletions).set({ purgedAt }).where(eq(accountDeletions.accountId, accountId)),
      )
    })

    /** Delete an account and everything it owns. Once access has ended and the deletion is recorded, the rest is
     * queued as well as tried at once; what neither finishes, the sweep does. */
    const deleteAccount = Effect.fn('Styld.Account.delete')(function* (accountId: string) {
      yield* closeAccount(db, accountId).pipe(Effect.provideService(SecureRandom.SecureRandom, random))
      yield* attempt(() => bindings.queue.send({ _tag: 'FinishDeletion', accountId })).pipe(Effect.ignore)
      yield* finishDeletion(accountId).pipe(Effect.ignore)
    })

    /** One recorded deletion, moved on: one still owed a purge is finished; one purged and drained is purged a last
     * time and forgotten. */
    const sweptDeletion = Effect.fnUntraced(function* (row: typeof accountDeletions.$inferSelect, drained: Date) {
      if (row.purgedAt === null) return yield* finishDeletion(row.accountId)
      if (row.purgedAt >= drained) return
      yield* purgeOutside(bucket, outside, row.accountId)
      yield* attempt(() => db.delete(accountDeletions).where(eq(accountDeletions.accountId, row.accountId)))
    })

    /** The schedule's sweep of deletions, each on its own. How many it moved. */
    const sweepDeletions = Effect.fn('Styld.Account.sweepDeletions')(function* () {
      const drained = yield* ago(drainedAfter)
      const rows = yield* dueDeletions(db, yield* ago(queuedPatience), drained)
      yield* Effect.forEach(
        rows,
        (row) =>
          sweptDeletion(row, drained).pipe(
            Effect.ignore({ log: true, message: 'Styld.Account.sweepDeletions left a deletion' }),
          ),
        { discard: true },
      )
      return rows.length
    })

    /** The account an operation acts for, while it is enabled: its name and the email address it signs in with (only
     * an active, verified email identifier). The one account read: assistants' `account_get`, and whether an
     * assistant's grant still stands and is an admin's. A closed account is `NotFound`. */
    const readAccount = Effect.fn('Styld.Account.read')(function* () {
      const { accountId } = yield* CurrentAccount
      const rows = yield* attempt(() =>
        db.all(
          sql`select a.id as accountId, a.display_name as displayName, (select i.value from ${authTables.identifiers} i where i.subject_id = a.id and i.active = 1 and i.namespace = 'email' and i.verified_at is not null limit 1) as email from ${accounts} a where a.id = ${accountId} and a.enabled = 1`,
        ),
      )
      const [row] = rows
      if (row === undefined) return yield* NotFound.make({})
      return yield* Schema.decodeUnknownEffect(AccountRow)(row).pipe(Effect.mapError(unavailable))
    })

    return { deleteAccount, finishDeletion, sweepDeletions, readAccount }
  })

/** Account termination, owned by the application: Yielded's `SubjectLifecycle` leaves it to us. */
export class AccountLifecycle extends Context.Service<AccountLifecycle, Effect.Success<ReturnType<typeof make>>>()(
  '@styld/server/AccountLifecycle',
) {
  /** Over the application's database, bucket and piece queue; an account's chats with Styld and its videos at Meta
   * go with it. */
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const chats = yield* ChatStores
      const database = yield* Database
      const segmenter = yield* GarmentSegmenter
      const bindings = { database, bucket: (yield* Media).bucket, queue: yield* PieceQueue }
      return yield* makeAccountLifecycle(bindings, {
        chats: (accountId) => chats.of(accountId).erase(),
        providerFiles: (accountId) =>
          forgetFilesOf(accountId).pipe(
            Effect.provideService(Database, database),
            Effect.provideService(GarmentSegmenter, segmenter),
          ),
      })
    }),
  )
}

/** @internal Exported for its tests. */
export const makeAccountLifecycle = (bindings: LifecycleBindings, outside: OutsideStores) =>
  Effect.map(make(bindings, outside), (service) => AccountLifecycle.of(service))
