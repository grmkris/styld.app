import { Effect, Layer, Option, Redacted } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { CurrentAccount } from '@styld/protocol'
import { type D1, McpOAuth } from '../OAuth.ts'
import { challenge, McpScope } from './Policy.ts'
import { readResource, resources } from './Resources.ts'
import { type Curation, isAdmin } from '../social/Curation.ts'
import { curationTools } from './CurationTools.ts'
import { instructions, styldTools, type ToolServices } from './StyldTools.ts'
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
export const mcpRoutes = (
  db: D1,
  origin: string,
  release: string,
  services: ToolServices & { readonly curation: Curation['Service'] },
  admins: ReadonlySet<string>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const server = yield* McpOAuth.Service
      const tools = styldTools(origin, services)
      return routesFor(server, {
        db,
        origin,
        release,
        tools,
        adminTools: [...tools, ...curationTools(services.curation)],
        admins,
      })
    }),
  )

/** Answer one authorized request with the tools and views, acting for `account`. */
const answerFor = Effect.fnUntraced(function* (
  served: {
    readonly release: string
    readonly tools: ReadonlyArray<ReturnType<typeof styldTools>[number]>
    readonly toolList: ReadonlyArray<object>
  },
  account: CurrentAccount['Service'],
  body: unknown,
) {
  const { release, tools, toolList } = served
  const request = yield* HttpServerRequest.HttpServerRequest
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
        resources,
        read: readResource,
        call: (name, args) =>
          Effect.runPromiseWith(services)(
            callTool(tools, name, args).pipe(Effect.provideService(CurrentAccount, account)),
          ),
      },
      body,
    ),
  )
  return HttpServerResponse.fromWeb(response)
})

const routesFor = (
  server: McpOAuthServer,
  {
    db,
    release,
    tools,
    adminTools,
    admins,
  }: {
    readonly db: D1
    readonly origin: string
    readonly release: string
    readonly tools: ReturnType<typeof styldTools>
    readonly adminTools: ReadonlyArray<ReturnType<typeof styldTools>[number]>
    readonly admins: ReadonlySet<string>
  },
) => {
  const member = { release, tools, toolList: renderTools(tools) }
  const admin = { release, tools: adminTools, toolList: renderTools(adminTools) }
  const servedFor = (row: unknown) => (isAdmin(admins, row) ? admin : member)
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
    // The same read says whether the account is on the admin list, by the verified email it signs in with.
    const enabled = yield* Effect.tryPromise(() =>
      db
        .prepare(
          "SELECT (SELECT i.value FROM styld_auth_identifiers i WHERE i.subject_id = a.id AND i.active = 1 AND i.namespace = 'email' AND i.verified_at IS NOT NULL LIMIT 1) AS email FROM accounts a WHERE a.id = ? AND a.enabled = 1",
        )
        .bind(access.subjectId)
        .first<unknown>(),
    ).pipe(Effect.option)
    // D1 did not answer: the token may be fine, so the client should retry rather than re-authorize.
    if (Option.isNone(enabled)) return HttpServerResponse.empty({ status: 503, headers: noStore })
    if (enabled.value === null)
      return HttpServerResponse.empty({
        status: 401,
        headers: { ...noStore, 'www-authenticate': challenge(server.resourceMetadata, 'invalid_token') },
      })
    const body = yield* request.json.pipe(Effect.option)
    if (Option.isNone(body)) return parseError
    const account = CurrentAccount.of({ accountId: access.subjectId, via: 'assistant' })
    return yield* answerFor(servedFor(enabled.value), account, body.value)
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
