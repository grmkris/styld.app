import { Effect, Layer, Option, Redacted } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { CurrentAccount } from '../CurrentAccount.ts'
import type { Wardrobe } from '../wardrobe/Wardrobe.ts'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import { type D1, McpOAuth } from '../OAuth.ts'
import { challenge, McpScope } from './Policy.ts'
import { instructions, styldTools } from './StyldTools.ts'
import { callTool, renderTools } from './Tools.ts'

type McpOAuthServer = typeof McpOAuth.Service.Service

const noStore = { 'cache-control': 'no-store' }

const bearer = (authorization: string | undefined) => {
  const match = /^Bearer ([\x21-\x7e]{1,4096})$/.exec(authorization ?? '')
  return match?.[1] === undefined ? Option.none() : Option.some(Redacted.make(match[1]))
}

const parseError = HttpServerResponse.jsonUnsafe(
  { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
  { status: 400, headers: noStore },
)

/** `/mcp`: a stateless Streamable HTTP endpoint for an OAuth-verified, still enabled account. */
export const mcpRoutes = (db: D1, origin: string, release: string, wardrobe: Wardrobe['Service']) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const server = yield* McpOAuth.Service
      // Photos an assistant points at are fetched without following redirects; ImageImport does.
      const http = yield* HttpClient.HttpClient.pipe(
        Effect.provide(
          FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'manual' }))),
        ),
      )
      return routesFor(server, { db, origin, release, tools: styldTools(db, origin, wardrobe, http) })
    }),
  )

const routesFor = (
  server: McpOAuthServer,
  {
    db,
    release,
    tools,
  }: {
    readonly db: D1
    readonly origin: string
    readonly release: string
    readonly tools: ReturnType<typeof styldTools>
  },
) => {
  const toolList = renderTools(tools)
  const post = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const token = bearer(request.headers['authorization'])
    if (Option.isNone(token))
      return HttpServerResponse.empty({
        status: 401,
        headers: { ...noStore, 'www-authenticate': challenge(server.resourceMetadata) },
      })
    // Outer None: the grant store is unavailable. Inner None: the token is not valid.
    const verified = yield* server.verify(token.value).pipe(
      Effect.map(Option.some),
      Effect.catchTag('OAuthServerInvalidToken', () => Effect.succeedNone),
      Effect.option,
    )
    if (Option.isNone(verified)) return HttpServerResponse.empty({ status: 503, headers: noStore })
    if (Option.isNone(verified.value))
      return HttpServerResponse.empty({
        status: 401,
        headers: { ...noStore, 'www-authenticate': challenge(server.resourceMetadata, 'invalid_token') },
      })
    const access = verified.value.value
    if (!access.scopes.includes(McpScope))
      return HttpServerResponse.empty({
        status: 403,
        headers: { ...noStore, 'www-authenticate': challenge(server.resourceMetadata, 'insufficient_scope') },
      })
    // A disabled account loses its assistants at once, whatever tokens they hold.
    const enabled = yield* Effect.tryPromise(() =>
      db.prepare('SELECT 1 AS ok FROM accounts WHERE id = ? AND enabled = 1').bind(access.subjectId).first<unknown>(),
    ).pipe(Effect.orElseSucceed(() => null))
    if (enabled === null)
      return HttpServerResponse.empty({
        status: 401,
        headers: { ...noStore, 'www-authenticate': challenge(server.resourceMetadata, 'invalid_token') },
      })
    const body = yield* request.json.pipe(Effect.option)
    if (Option.isNone(body)) return parseError
    const account = CurrentAccount.of({ accountId: access.subjectId, via: 'assistant' })
    const services = yield* Effect.context()
    const sdk = yield* Effect.promise(() => import('./Sdk.ts'))
    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
    const response = yield* Effect.promise(() =>
      sdk.answer(
        web,
        {
          serverInfo: { name: 'styld', version: release },
          instructions,
          tools: toolList,
          call: (name, args) =>
            Effect.runPromiseWith(services)(
              callTool(tools, name, args).pipe(Effect.provideService(CurrentAccount, account)),
            ),
        },
        body.value,
      ),
    )
    return HttpServerResponse.fromWeb(response)
  })
  const notAllowed = Effect.succeed(
    HttpServerResponse.text('Use POST for this stateless MCP endpoint.', { status: 405, headers: { allow: 'POST' } }),
  )
  return Layer.mergeAll(
    HttpRouter.add('POST', '/mcp', post),
    HttpRouter.add('GET', '/mcp', notAllowed),
    HttpRouter.add('DELETE', '/mcp', notAllowed),
  )
}
