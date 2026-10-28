type FetchService = {
  readonly fetch: (request: Request) => Promise<Response>
}

export type EdgeEnvironment = {
  readonly API: FetchService
  readonly WEBSITE: FetchService
}

const apiNamespaces = ['/api', '/rpc', '/mcp', '/.well-known', '/out', '/cdn'] as const

export const isApiPath = (path: string): boolean =>
  apiNamespaces.some((namespace) => path === namespace || path.startsWith(`${namespace}/`))

/** Native transport boundary. Forward the original request and response so
 * streams, cookies, redirects, cancellation and WebSockets keep platform semantics. */
export default {
  fetch(request: Request, env: EdgeEnvironment): Promise<Response> {
    return (isApiPath(new URL(request.url).pathname) ? env.API : env.WEBSITE).fetch(request)
  },
}
