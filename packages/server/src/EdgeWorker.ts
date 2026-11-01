// workerd treats a Worker module's named exports as entrypoints: exporting a
// plain constant from this file fails every request with 502.
import { decodeMeta, hasPreview, headTags, type PageMeta } from './EdgeMeta.ts'
import { apiPolicy, documentPolicy, withSecurityHeaders } from './EdgeSecurity.ts'

type FetchService = {
  readonly fetch: (request: Request) => Promise<Response>
}

export type EdgeEnvironment = {
  readonly API: FetchService
  readonly WEBSITE: FetchService
  /** `noindex` keeps a preview deployment out of search engines; link previews still read its pages. */
  readonly ROBOTS?: string
}

const apiNamespaces = ['/api', '/mcp', '/oauth', '/.well-known', '/cdn'] as const

export const isApiPath = (path: string): boolean =>
  apiNamespaces.some((namespace) => path === namespace || path.startsWith(`${namespace}/`))

/** How long a public page waits for its link preview before it goes out without one. */
const previewPatience = 1500

/** The link preview of a public page, read from the API Worker in the reader's language; none if it is not public,
 * slow or failing. */
const previewOf = async (request: Request, env: EdgeEnvironment, path: string): Promise<PageMeta | undefined> => {
  const headers = new Headers()
  for (const name of ['accept-language', 'cf-connecting-ip', 'x-styld-correlation-id']) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const url = new URL(`/api/public/meta?path=${encodeURIComponent(path)}`, request.url)
  try {
    const answer = await env.API.fetch(new Request(url, { headers, signal: AbortSignal.timeout(previewPatience) }))
    return answer.ok ? decodeMeta(await answer.json()) : undefined
  } catch {
    return undefined
  }
}

/** A public page goes out with its preview's title and tags in its head, or unchanged without one. */
const withPreview = (response: Response, meta: PageMeta | undefined, url: URL): Response => {
  const isPage = response.status === 200 && (response.headers.get('content-type') ?? '').startsWith('text/html')
  if (meta === undefined || !isPage || typeof HTMLRewriter === 'undefined') return response
  const tags = headTags(meta, `${url.origin}${url.pathname}`)
  return new HTMLRewriter()
    .on('title', { element: (title) => void title.setInnerContent(meta.title) })
    .on('head', { element: (head) => void head.append(tags, { html: true }) })
    .transform(response)
}

/** v1's share links, `/share/board/:id`, now open the board's own address. */
const sharedBoard = /^\/share\/board\/([A-Za-z0-9_-]{1,40})$/u

/** Native transport boundary. Reserved telemetry fields belong to the edge;
 * callers cannot choose log labels or smuggle payloads through correlation IDs.
 * Request bodies and responses keep their native streaming semantics; the edge
 * adds the security headers for every page and API response. */
export default {
  async fetch(request: Request, env: EdgeEnvironment): Promise<Response> {
    const headers = new Headers(request.headers)
    for (const name of request.headers.keys()) {
      if (name.startsWith('x-styld-')) headers.delete(name)
    }
    const correlationId = crypto.randomUUID()
    headers.set('x-styld-correlation-id', correlationId)
    const forwarded = new Request(request, { headers })
    const url = new URL(request.url)
    const shared = sharedBoard.exec(url.pathname)?.[1]
    if (shared !== undefined)
      return withSecurityHeaders(Response.redirect(new URL(`/boards/${shared}`, url).href, 301), documentPolicy)
    const api = isApiPath(url.pathname)
    // The preview is read while the page renders.
    const preview =
      !api && request.method === 'GET' && hasPreview(url.pathname)
        ? previewOf(forwarded, env, url.pathname)
        : Promise.resolve(undefined)
    const response = await (api ? env.API : env.WEBSITE).fetch(forwarded)
    const secured = withSecurityHeaders(
      withPreview(response, await preview, url),
      api ? apiPolicy : documentPolicy,
      api,
    )
    if (secured.status === 101) return secured
    if (env.ROBOTS === 'noindex') secured.headers.set('x-robots-tag', 'noindex')
    // The id the logs of this request carry, so a person reporting a problem can quote it.
    secured.headers.set('x-styld-correlation-id', correlationId)
    return secured
  },
}
