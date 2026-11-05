import { accounts, authMirror, oauthAssertions, oauthClients, oauthGrants } from '@styld/db'
import { OAuthServer } from '@yielded/auth'
import { and, eq, ne, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import type { ConsentPerson } from './ConsentPage.ts'
import { type Database, query } from './kernel/Db.ts'

// The MCP OAuth server's rows in D1 (`OAuth.ts` serves them): its grants, the assertions it consumed, the clients that
// registered, and the signed-in person its consent page names.

const { identifiers } = authMirror

const unavailable = () => new OAuthServer.Unavailable()

type Drizzle = Database['Service']

/** A D1 call of the OAuth server: D1 not answering is the server being unavailable. */
export const stored = <A>(run: () => Promise<A>) => query(run).pipe(Effect.mapError(unavailable))

const RecordJson = Schema.fromJsonString(OAuthServer.Record)

/** One grant, by its namespace and id. */
const grant = (namespace: string, id: string) => and(eq(oauthGrants.namespace, namespace), eq(oauthGrants.id, id))

/** The OAuth server's grants and assertion receipts in D1. A row written (or changed) is the only success signal, so
 * a lost race or a replay reads as `false`, never as an error. */
export const persistence = (db: Drizzle) =>
  OAuthServer.Persistence.of({
    get: (namespace, id) =>
      stored(() =>
        db.select({ record: oauthGrants.record }).from(oauthGrants).where(grant(namespace, id)).limit(1),
      ).pipe(
        Effect.flatMap(([row]) =>
          row === undefined
            ? Effect.succeed(undefined)
            : Schema.decodeUnknownEffect(RecordJson)(row.record).pipe(Effect.mapError(unavailable)),
        ),
      ),
    insert: (namespace, id, record) =>
      Effect.flatMap(Schema.encodeEffect(RecordJson)(record).pipe(Effect.mapError(unavailable)), (json) =>
        stored(() =>
          db
            .insert(oauthGrants)
            .values({
              namespace,
              id,
              version: record.version,
              record: json,
              subjectId: record.subjectId ?? null,
              expiresAt: record.expiresAtMillis,
            })
            .onConflictDoNothing()
            .returning({ id: oauthGrants.id }),
        ),
      ).pipe(Effect.map((written) => written.length === 1)),
    compareAndSet: (namespace, id, version, record) =>
      Effect.flatMap(Schema.encodeEffect(RecordJson)(record).pipe(Effect.mapError(unavailable)), (json) =>
        stored(() =>
          db
            .update(oauthGrants)
            .set({
              version: record.version,
              record: json,
              subjectId: record.subjectId ?? null,
              expiresAt: record.expiresAtMillis,
            })
            .where(
              and(
                grant(namespace, id),
                eq(oauthGrants.version, version),
                ne(sql`json_extract(${oauthGrants.record}, '$.status')`, 'Revoked'),
              ),
            )
            .returning({ id: oauthGrants.id }),
        ),
      ).pipe(Effect.map((changed) => changed.length === 1)),
    revoke: (namespace, id) =>
      stored(() =>
        db
          .update(oauthGrants)
          .set({ record: sql`json_set(${oauthGrants.record}, '$.status', 'Revoked')` })
          .where(grant(namespace, id)),
      ).pipe(Effect.asVoid),
    consumeAssertion: (namespace, receipt) =>
      stored(() =>
        db
          .insert(oauthAssertions)
          .values({ namespace, receipt: receipt.id, expiresAt: receipt.expiresAtMillis })
          .onConflictDoNothing()
          .returning({ receipt: oauthAssertions.receipt }),
      ).pipe(Effect.map((written) => written.length === 1)),
  })

const StoredClient = Schema.Struct({
  clientId: Schema.String,
  name: Schema.String,
  redirectUris: Schema.NonEmptyArray(Schema.String),
  applicationType: Schema.Literals(['web', 'native']),
})

/** Dynamically registered clients, read by exact ID. Untrusted IDs that cannot be ours are unknown. */
export const registeredClients = (db: Drizzle) => ({
  get: (clientId: string) =>
    !/^dcr_[0-9a-f]{32}$/.test(clientId)
      ? Effect.succeed(undefined)
      : stored(() =>
          db
            .select({
              clientId: oauthClients.clientId,
              name: oauthClients.name,
              redirectUris: oauthClients.redirectUris,
              applicationType: oauthClients.applicationType,
            })
            .from(oauthClients)
            .where(eq(oauthClients.clientId, clientId))
            .limit(1),
        ).pipe(
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(undefined)
              : Effect.map(
                  Schema.decodeUnknownEffect(StoredClient)(row).pipe(Effect.mapError(unavailable)),
                  (client) => ({ ...client, grantTypes: ['authorization_code' as const, 'refresh_token' as const] }),
                ),
          ),
        ),
})

/** The signed-in person as the consent page names them: their display name and the email they sign in with. */
export const personOf = (db: Drizzle, subjectId: string) =>
  Effect.map(
    Effect.all([
      stored(() => db.select({ name: accounts.displayName }).from(accounts).where(eq(accounts.id, subjectId)).limit(1)),
      stored(() =>
        db
          .select({ value: identifiers.value })
          .from(identifiers)
          .where(
            and(eq(identifiers.subjectId, subjectId), eq(identifiers.namespace, 'email'), eq(identifiers.active, true)),
          )
          .limit(1),
      ),
    ]),
    ([[account], [email]]): ConsentPerson => ({ name: account?.name ?? email?.value ?? '', email: email?.value }),
  )
