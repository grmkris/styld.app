import { authAttemptBuckets } from '@styld/db'
import { Password } from '@yielded/auth'
import { asc, inArray, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { EmailEntryBudget, emailBudgets } from './EmailEntry.ts'
import { Effect, Layer, Redacted, Schema } from 'effect'
import type * as D1Client from '@effect/sql-d1/D1Client'

// @effect-diagnostics-next-line unstableApiUsage:off -- The pinned Effect D1 adapter defines the native Worker database binding.
export type D1Source<R = never> = Effect.Effect<D1Client.D1ClientConfig['db'], never, R>

type Database = ReturnType<typeof drizzle>

const encoder = new TextEncoder()
const buckets = authAttemptBuckets
/** D1's clock in epoch milliseconds, so every Worker's write is measured by the same clock. */
const databaseNow = sql<number>`CAST(unixepoch('subsec') * 1000 AS INTEGER)`

/** The statements that take one token from a bucket, for one batch: up to 64 expired buckets are swept, then the token
 * is taken. D1 serializes this single conditional write across Workers. A rejected attempt does not debit below zero
 * (the update's condition refuses it and nothing is returned); expiry means the bucket has had time to refill fully. */
const consume = (
  db: Database,
  bucket: string,
  { limit, windowMillis }: { readonly limit: number; readonly windowMillis: number },
) => {
  const refilled = sql<number>`min(${limit}, ${buckets.tokens} + max(0, excluded.updated_at - ${buckets.updatedAt}) * 1.0 * ${limit} / ${windowMillis})`
  return [
    db
      .delete(buckets)
      .where(
        inArray(
          buckets.key,
          db
            .select({ key: buckets.key })
            .from(buckets)
            .where(lte(buckets.expiresAt, databaseNow))
            .orderBy(asc(buckets.expiresAt))
            .limit(64),
        ),
      ),
    db
      .insert(buckets)
      .values({
        key: bucket,
        tokens: limit - 1,
        updatedAt: databaseNow,
        expiresAt: sql<number>`${databaseNow} + ${windowMillis}`,
      })
      .onConflictDoUpdate({
        target: buckets.key,
        set: {
          tokens: sql<number>`${refilled} - 1`,
          updatedAt: sql<number>`max(excluded.updated_at, ${buckets.updatedAt})`,
          expiresAt: sql<number>`max(excluded.expires_at, ${buckets.expiresAt})`,
        },
        setWhere: sql`${refilled} >= 1`,
      })
      .returning({ key: buckets.key }),
  ] as const
}

/** The bucket a digest names: lower-case hex, so D1 never holds the identifier itself. */
const hex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')

const hmacKey = (secret: Redacted.Redacted) =>
  Effect.tryPromise(() =>
    crypto.subtle.importKey('raw', encoder.encode(Redacted.value(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]),
  )

/** Take one token from the D1 bucket named by `parts`: true when there was one. The bucket key is
 * an HMAC of the parts, so D1 never holds the identifier itself. */
const takeToken = (
  db: Database,
  key: CryptoKey,
  parts: ReadonlyArray<string>,
  budget: { readonly limit: number; readonly windowMillis: number },
) =>
  Effect.gen(function* () {
    const digest = yield* Effect.tryPromise(() =>
      crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(parts))),
    )
    const [, taken] = yield* Effect.tryPromise(() => db.batch(consume(db, hex(digest), budget)))
    return taken.length === 1
  })

/** Email entry's durable per-address budgets: codes asked for, and codes tried. They hold across
 * Worker isolates, where Yielded's default counters would reset. */
export const emailEntryBudgetLayer = <R>(raw: D1Source<R>, secret: Redacted.Redacted) =>
  Layer.effect(
    EmailEntryBudget,
    Effect.gen(function* () {
      const db = drizzle(yield* raw)
      const key = yield* hmacKey(secret).pipe(Effect.orDie)
      const take = (kind: string, email: string, budget: { readonly limit: number; readonly windowMillis: number }) =>
        takeToken(db, key, ['styld/email-entry/v1', kind, email], budget).pipe(Effect.orElseSucceed(() => false))
      return EmailEntryBudget.of({
        request: (email) => take('request', email, emailBudgets.request),
        complete: (email) => take('complete', email, emailBudgets.complete),
      })
    }),
  )

export const passwordAttemptLimiter = <R>(raw: D1Source<R>, secret: Redacted.Redacted) =>
  Layer.effect(
    Password.PasswordAttemptLimiter,
    Effect.gen(function* () {
      const db = drizzle(yield* raw)
      const key = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.importKey(
            'raw',
            encoder.encode(Redacted.value(secret)),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
          ),
        catch: () => Password.PasswordUnavailable.make({}),
      })
      return Password.PasswordAttemptLimiter.of({
        check: Effect.fn('Styld.Auth.limitPasswordAttempts')(function* (input) {
          const budget = yield* Schema.decodeUnknownEffect(Password.PasswordAttemptPolicy.fields.identifier)(
            input.budget,
          ).pipe(Effect.mapError(() => Password.PasswordUnavailable.make({})))
          const digest = yield* Effect.tryPromise({
            try: () =>
              crypto.subtle.sign(
                'HMAC',
                key,
                encoder.encode(
                  JSON.stringify(['styld/password-attempt/v1', input.moduleId, input.action, input.scope, input.key]),
                ),
              ),
            catch: () => Password.PasswordUnavailable.make({}),
          })
          const [, taken] = yield* Effect.tryPromise({
            try: () => db.batch(consume(db, hex(digest), budget)),
            catch: () => Password.PasswordUnavailable.make({}),
          })
          if (taken.length !== 1) return yield* Password.PasswordRejected.make({})
        }),
      })
    }),
  )
