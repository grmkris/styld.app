/**
 * The MCP SDK server behind `/mcp`, ported from the owner's myapps (`packages/mcp/src/serve-sdk.ts`).
 * The route imports this module on an isolate's first MCP request: in workerd the SDK builds every
 * protocol schema when it loads (about 65 ms of CPU), which Worker startup does not pay. Servers are
 * stateless and built per request; the 2026-07-28 handler is one per isolate, and older protocol
 * eras get a per-request transport with JSON responses (never SSE, which old clients misread).
 */
import {
  createMcpHandler,
  isLegacyRequest,
  ResourceNotFoundError,
  Server,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/server'

/** What one request's server serves: the tool list and the call bound to its caller. */
export type McpApp = {
  readonly serverInfo: { readonly name: string; readonly version: string }
  readonly instructions: string
  readonly tools: ReadonlyArray<object>
  readonly call: (name: string, args: unknown) => Promise<CallToolResult>
  /** The MCP Apps views (`ui://`), which hosts read to render tool results. */
  readonly resources: ReadonlyArray<object>
  readonly read: (uri: string) => ReadResourceResult | undefined
}

const serverFor = (app: McpApp) => {
  // The low-level Server serves the app's own pinned tools/list entries unchanged.
  const server = new Server(app.serverInfo, {
    capabilities: { tools: {}, resources: {} },
    instructions: app.instructions,
  })
  // SAFETY: tools/list serves the app's own rendered tool entries -- the SDK Tool type is narrower than these JSON Schema descriptors, which must pass through byte for byte
  server.setRequestHandler('tools/list', () => Promise.resolve({ tools: app.tools as never }))
  server.setRequestHandler('tools/call', (request) => app.call(request.params.name, request.params.arguments ?? {}))
  // SAFETY: resources/list serves the app's own resource entries -- their `_meta.ui` objects are MCP Apps fields the SDK Resource type does not declare
  server.setRequestHandler('resources/list', () => Promise.resolve({ resources: app.resources as never }))
  server.setRequestHandler('resources/templates/list', () => Promise.resolve({ resourceTemplates: [] }))
  server.setRequestHandler('resources/read', (request) => {
    const found = app.read(request.params.uri)
    return found === undefined ? Promise.reject(new ResourceNotFoundError(request.params.uri)) : Promise.resolve(found)
  })
  return server
}

/** The server builder of each request the 2026-07-28 handler is serving, keyed by that request. */
const inFlight = new WeakMap<Request, () => ReturnType<typeof serverFor>>()

const modern = createMcpHandler(
  ({ requestInfo }) => {
    const build = requestInfo === undefined ? undefined : inFlight.get(requestInfo)
    if (build === undefined) throw new Error('No MCP app is bound to this request')
    return build()
  },
  { legacy: 'reject' },
)

/** A 2025-era request: a stateless transport (no session ids) answering with JSON. */
const answerLegacy = async (request: Request, app: McpApp, parsedBody: unknown) => {
  const server = serverFor(app)
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request, { parsedBody })
  } finally {
    await server.close()
  }
}

/** Answer one MCP POST for `app`. */
export const answer = async (request: Request, app: McpApp, parsedBody: unknown): Promise<Response> => {
  if (await isLegacyRequest(request, parsedBody)) return answerLegacy(request, app, parsedBody)
  inFlight.set(request, () => serverFor(app))
  try {
    return await modern.fetch(request, { parsedBody })
  } finally {
    inFlight.delete(request)
  }
}
