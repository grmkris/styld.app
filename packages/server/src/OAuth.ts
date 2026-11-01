import { OAuthServer } from '@yielded/auth'
import * as WorkerdServices from '@yielded/auth/WorkerdServices'
import { Clock, Effect, Layer, Option, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { type AuthHttp, sessionCookieAccount } from './AuthHttp.ts'
import type { AuthSessionKeyring } from './AuthConfiguration.ts'
import { hostedClientMetadata, McpScope, redirectUriAllowed } from './mcp/Policy.ts'

/** Styld's authorization server for MCP clients: Yielded's authorization-code server with PKCE,
 * rotating refresh tokens and client metadata documents. */
export const McpOAuth = OAuthServer.make('mcp', { scopes: [McpScope] })

const unavailable = () => new OAuthServer.Unavailable()

export type D1 = {
  readonly prepare: (query: string) => {
    readonly bind: (...values: ReadonlyArray<unknown>) => {
      readonly first: <T>() => Promise<T | null>
      readonly run: () => Promise<{ readonly meta: { readonly changes: number } }>
    }
  }
}

const query = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: unavailable })

const RecordJson = Schema.fromJsonString(OAuthServer.Record)

/** The OAuth server's grants and assertion receipts in D1. A changed row count is the only
 * success signal, so a lost race or a replay reads as `false`, never as an error. */
const persistence = (db: D1) =>
  OAuthServer.Persistence.of({
    get: (namespace, id) =>
      query(() =>
        db.prepare('SELECT record FROM oauth_grants WHERE namespace = ? AND id = ?').bind(namespace, id).first<{
          readonly record: string
        }>(),
      ).pipe(
        Effect.flatMap((row) =>
          row === null
            ? Effect.succeed(undefined)
            : Schema.decodeUnknownEffect(RecordJson)(row.record).pipe(Effect.mapError(unavailable)),
        ),
      ),
    insert: (namespace, id, record) =>
      Effect.flatMap(Schema.encodeEffect(RecordJson)(record).pipe(Effect.mapError(unavailable)), (json) =>
        query(() =>
          db
            .prepare(
              'INSERT OR IGNORE INTO oauth_grants (namespace, id, version, record, subject_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .bind(namespace, id, record.version, json, record.subjectId ?? null, record.expiresAtMillis)
            .run(),
        ),
      ).pipe(Effect.map(({ meta }) => meta.changes === 1)),
    compareAndSet: (namespace, id, version, record) =>
      Effect.flatMap(Schema.encodeEffect(RecordJson)(record).pipe(Effect.mapError(unavailable)), (json) =>
        query(() =>
          db
            .prepare(
              'UPDATE oauth_grants SET version = ?, record = ?, subject_id = ?, expires_at = ? WHERE namespace = ? AND id = ? AND version = ?',
            )
            .bind(record.version, json, record.subjectId ?? null, record.expiresAtMillis, namespace, id, version)
            .run(),
        ),
      ).pipe(Effect.map(({ meta }) => meta.changes === 1)),
    revoke: (namespace, id) =>
      query(() =>
        db
          .prepare(
            "UPDATE oauth_grants SET record = json_set(record, '$.status', 'Revoked') WHERE namespace = ? AND id = ?",
          )
          .bind(namespace, id)
          .run(),
      ).pipe(Effect.asVoid),
    consumeAssertion: (namespace, receipt) =>
      query(() =>
        db
          .prepare('INSERT OR IGNORE INTO oauth_assertions (namespace, receipt, expires_at) VALUES (?, ?, ?)')
          .bind(namespace, receipt.id, receipt.expiresAtMillis)
          .run(),
      ).pipe(Effect.map(({ meta }) => meta.changes === 1)),
  })

const StoredClient = Schema.Struct({
  client_id: Schema.String,
  name: Schema.String,
  redirect_uris: Schema.fromJsonString(Schema.NonEmptyArray(Schema.String)),
  application_type: Schema.Literals(['web', 'native']),
})

/** Dynamically registered clients, read by exact ID. Untrusted IDs that cannot be ours are unknown. */
const registeredClients = (db: D1) =>
  McpOAuth.Clients.of({
    get: (clientId) =>
      !/^dcr_[0-9a-f]{32}$/.test(clientId)
        ? Effect.succeed(undefined)
        : query(() =>
            db
              .prepare('SELECT client_id, name, redirect_uris, application_type FROM oauth_clients WHERE client_id = ?')
              .bind(clientId)
              .first<unknown>(),
          ).pipe(
            Effect.flatMap((row) =>
              row === null
                ? Effect.succeed(undefined)
                : Effect.map(
                    Schema.decodeUnknownEffect(StoredClient)(row).pipe(Effect.mapError(unavailable)),
                    (client) => ({
                      clientId: client.client_id,
                      name: client.name,
                      redirectUris: client.redirect_uris,
                      applicationType: client.application_type,
                      grantTypes: ['authorization_code' as const, 'refresh_token' as const],
                    }),
                  ),
            ),
          ),
  })

/** The signed-in person behind an authorization request: the same session cookie the website uses. A missing or
 * invalid session is anonymous and leads to the login page. */
const sessionIdentity = (auth: AuthHttp) =>
  Layer.effect(
    McpOAuth.Identity,
    Effect.map(sessionCookieAccount(auth), (account) =>
      McpOAuth.Identity.of({
        current: account.pipe(Effect.map(Option.getOrUndefined), Effect.mapError(unavailable)),
      }),
    ),
  )

const RegistrationRequest = Schema.Struct({
  client_name: Schema.optional(Schema.String),
  redirect_uris: Schema.Array(Schema.String),
  token_endpoint_auth_method: Schema.optional(Schema.String),
})

const registrationError = (error: string, description: string) =>
  HttpServerResponse.jsonUnsafe(
    { error, error_description: description },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  )

/** Dynamic client registration (RFC 7591) for public clients. Requested grant types are narrowed to
 * the authorization code and refresh token rather than refused, as hosted clients declare extras. */
const register = <R>(db: D1, allow: (client: string) => Effect.Effect<boolean, never, R>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!(yield* allow(request.headers['cf-connecting-ip'] ?? 'unknown')))
      return HttpServerResponse.empty({ status: 429, headers: { 'retry-after': '60' } })
    const body = yield* request.json.pipe(Effect.option)
    const input = Option.flatMap(body, Schema.decodeUnknownOption(RegistrationRequest))
    if (Option.isNone(input)) return registrationError('invalid_client_metadata', 'The registration is not valid JSON.')
    const { client_name, redirect_uris, token_endpoint_auth_method } = input.value
    if (token_endpoint_auth_method !== undefined && token_endpoint_auth_method !== 'none')
      return registrationError('invalid_client_metadata', 'Only public clients with PKCE can register.')
    if (redirect_uris.length === 0 || redirect_uris.length > 16 || !redirect_uris.every(redirectUriAllowed))
      return registrationError('invalid_redirect_uri', 'Use https, or http on a loopback address.')
    const native = redirect_uris.every((uri) => new URL(uri).protocol === 'http:')
    const clientId = `dcr_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    const name = (client_name ?? '').trim().slice(0, 120) || 'MCP client'
    const issuedAt = yield* Clock.currentTimeMillis
    yield* query(() =>
      db
        .prepare(
          'INSERT INTO oauth_clients (client_id, name, redirect_uris, application_type, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(clientId, name, JSON.stringify(redirect_uris), native ? 'native' : 'web', issuedAt)
        .run(),
    )
    return HttpServerResponse.jsonUnsafe(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(issuedAt / 1000),
        client_name: name,
        redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: native ? 'native' : 'web',
      },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    )
  }).pipe(Effect.catchTag('OAuthServerUnavailable', () => Effect.succeed(HttpServerResponse.empty({ status: 503 }))))

/** The OAuth routes: Yielded's authorize, token, revoke and metadata endpoints, the registration
 * endpoint it leaves to the application, and its server metadata with that endpoint added. */
const routes = <R>(db: D1, origin: string, allowRegistration: (client: string) => Effect.Effect<boolean, never, R>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const server = yield* McpOAuth.Service
      const forward = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        // A metadata-document client must be one of the hosted clients, by exact URL.
        const clientId = new URL(request.url, origin).searchParams.get('client_id')
        if (clientId?.startsWith('https://') === true && !hostedClientMetadata.has(clientId))
          return registrationError('invalid_client', 'This client is not registered.')
        return HttpServerResponse.fromWeb(
          yield* server.handle(yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)),
        )
      })
      const metadata = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const response = yield* server.handle(yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie))
        if (!response.ok) return HttpServerResponse.fromWeb(response)
        const document = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(
          yield* Effect.promise(() => response.json()),
        )
        if (Option.isNone(document)) return HttpServerResponse.empty({ status: 502 })
        return HttpServerResponse.jsonUnsafe(
          { ...document.value, registration_endpoint: `${origin}/oauth/mcp/register` },
          { headers: { 'cache-control': response.headers.get('cache-control') ?? 'max-age=300' } },
        )
      })
      return Layer.mergeAll(
        HttpRouter.add('*', McpOAuth.paths.authorize, forward),
        HttpRouter.add('*', McpOAuth.paths.token, forward),
        HttpRouter.add('*', McpOAuth.paths.revoke, forward),
        HttpRouter.add('GET', McpOAuth.paths.metadata, metadata),
        HttpRouter.add('GET', '/.well-known/oauth-protected-resource/mcp', forward),
        HttpRouter.add('POST', '/oauth/mcp/register', register(db, allowRegistration)),
      )
    }),
  )

export type McpOAuthOptions<R> = {
  readonly origin: string
  readonly keys: AuthSessionKeyring
  readonly allowRegistration: (client: string) => Effect.Effect<boolean, never, R>
}

/** The OAuth server for MCP and its routes, built on the session auth and the D1 binding. */
export const makeMcpOAuth = <R>(db: D1, auth: AuthHttp, options: McpOAuthOptions<R>) => {
  const server = McpOAuth.layer({
    origin: options.origin,
    resource: `${options.origin}/mcp`,
    clients: [],
    clientMetadata: { allowedOrigins: ['https://claude.ai', 'https://chatgpt.com', 'https://vscode.dev'] },
    loginPath: '/login/connect',
    keys: options.keys,
  }).pipe(
    Layer.provide(Layer.succeed(OAuthServer.Persistence, persistence(db))),
    Layer.provide(Layer.succeed(McpOAuth.Clients, registeredClients(db))),
    Layer.provide(sessionIdentity(auth)),
    // Metadata documents are fetched without following redirects.
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'manual' })),
    Layer.provide(WorkerdServices.layer),
  )
  return {
    server,
    routes: routes(db, options.origin, options.allowRegistration).pipe(Layer.provide(server)),
  }
}
