import { oauthClients } from '@styld/db'
import { OAuthServer } from '@yielded/auth'
import * as WorkerdServices from '@yielded/auth-platform-workerd'
import { Clock, Effect, Layer, Option, Schema } from 'effect'
import { publicWebTransport } from '../providers/PublicWeb.ts'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { Auth, type AuthHttp, sessionCookieAccount } from '../AuthHttp.ts'
import { Deployment } from '../Config.ts'
import { Database } from '../kernel/Db.ts'
import { persistence, personOf, registeredClients, stored } from './OAuthStore.ts'
import { hostedClientMetadata, McpScope, redirectUriAllowed } from './Policy.ts'
import { networkOf, Pacing } from '../kernel/Pacing.ts'
import { consentPage, consentStylesheet, consentStylesheetPath } from '../ConsentPage.ts'
import { readerLocaleOf } from '../social/Translated.ts'

/** Styld's authorization server for MCP clients: Yielded's authorization-code server with PKCE,
 * rotating refresh tokens and client metadata documents. */
export const McpOAuth = OAuthServer.make('mcp', { scopes: [McpScope] })

const unavailable = () => new OAuthServer.Unavailable()

type Drizzle = Database['Service']

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
const register = <R>(db: Drizzle, allow: (client: string) => Effect.Effect<boolean, never, R>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!(yield* allow(networkOf(request.headers))))
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
    yield* stored(() =>
      db.insert(oauthClients).values({
        clientId,
        name,
        redirectUris: redirect_uris,
        applicationType: native ? 'native' : 'web',
        createdAt: new Date(issuedAt),
      }),
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
const routes = <R>(
  db: Drizzle,
  origin: string,
  allowRegistration: (client: string) => Effect.Effect<boolean, never, R>,
) =>
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
        HttpRouter.add('GET', consentStylesheetPath, Effect.succeed(consentStyles)),
        HttpRouter.add('GET', '/.well-known/oauth-protected-resource/mcp', forward),
        HttpRouter.add('POST', '/oauth/mcp/register', register(db, allowRegistration)),
      )
    }),
  )

/** The consent page in Styld's look and the reader's language (`ConsentPage.ts`). */
const styldConsent = (db: Drizzle) =>
  Layer.succeed(
    OAuthServer.ConsentRenderer,
    OAuthServer.ConsentRenderer.of({
      render: (consent) =>
        Effect.gen(function* () {
          const request = yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest)
          const locale = Option.match(request, {
            onNone: () => 'en' as const,
            onSome: ({ headers }) => readerLocaleOf(headers),
          })
          return consentPage(consent, yield* personOf(db, consent.subjectId), locale)
        }),
    }),
  )

/** The consent page's stylesheet: the one style source its policy allows. */
const consentStyles = HttpServerResponse.text(consentStylesheet, {
  contentType: 'text/css; charset=utf-8',
  headers: { 'cache-control': 'public, max-age=3600' },
})

/** The OAuth server for MCP, over the application's database and the website's session. */
export const mcpOAuthServer = Layer.unwrap(
  Effect.gen(function* () {
    const db = yield* Database
    const deployment = yield* Deployment
    return McpOAuth.layer({
      origin: deployment.origin,
      resource: `${deployment.origin}/mcp`,
      clients: [],
      clientMetadata: { allowedOrigins: ['https://claude.ai', 'https://chatgpt.com', 'https://vscode.dev'] },
      loginPath: '/login/connect',
      keys: deployment.auth.sessionKeys,
    }).pipe(
      Layer.provide(Layer.succeed(OAuthServer.Persistence, persistence(db))),
      Layer.provide(styldConsent(db)),
      Layer.provide(Layer.succeed(McpOAuth.Clients, McpOAuth.Clients.of(registeredClients(db)))),
      Layer.provide(sessionIdentity(yield* Auth)),
      // Client metadata documents are fetched from the public web without following redirects.
      Layer.provide(publicWebTransport),
      Layer.provide(WorkerdServices.layer),
    )
  }),
)

/** The OAuth routes over the server, registration paced by network. */
export const mcpOAuthRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const db = yield* Database
    const { origin } = yield* Deployment
    const pacing = yield* Pacing
    return routes(db, origin, (network) => pacing.allows('registration', network))
  }),
)
