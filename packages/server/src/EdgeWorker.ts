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

/** Where Google returns (`AuthHttp.ts` › googleCallbackPath; named again here because this module may export nothing
 * but its entrypoint). */
const googleCallback = '/api/auth/callback/google'

/** Yielded answers a Google sign-in it refuses with JSON; the person gets the login page and a sentence instead. */
const signInPage = (response: Response, url: URL): Response =>
  url.pathname === googleCallback && response.status >= 400
    ? new Response(null, { status: 303, headers: { location: '/login?problem=google' } })
    : response

export const isApiPath = (path: string): boolean =>
  apiNamespaces.some((namespace) => path === namespace || path.startsWith(`${namespace}/`))

/** How long a public page waits for its link preview before it goes out without one. */
const previewPatience = 1500

/** The link preview of a public page, read from the API Worker in the reader's language and as the reader (the
 * session cookie goes along, so a block hides the preview as it hides the page); none if it is not public, slow or
 * failing. */
const previewOf = async (request: Request, env: EdgeEnvironment, path: string): Promise<PageMeta | undefined> => {
  const headers = new Headers()
  for (const name of ['accept-language', 'cf-connecting-ip', 'cookie', 'x-styld-correlation-id']) {
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

/** The site-wide link-preview tags the website renders into every page (`apps/web/src/entry.server.ts`). */
const sharedTags = 'meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]'

/** A profile, board, look or piece page has one source of link-preview tags, the edge: the website's site-wide ones
 * are taken out, and a public page gets its own title and tags. A private or missing one keeps no preview at all. */
const withPreview = (response: Response, meta: PageMeta | undefined, url: URL): Response => {
  const isPage = response.status === 200 && (response.headers.get('content-type') ?? '').startsWith('text/html')
  if (!isPage || typeof HTMLRewriter === 'undefined') return response
  const rewriter = new HTMLRewriter().on(sharedTags, { element: (tag) => void tag.remove() })
  if (meta === undefined) return rewriter.transform(response)
  const tags = headTags(meta, `${url.origin}${url.pathname}`)
  return rewriter
    .on('title', { element: (title) => void title.setInnerContent(meta.title) })
    .on('head', { element: (head) => void head.append(tags, { html: true }) })
    .transform(response)
}

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
    const api = isApiPath(url.pathname)
    // The preview is read while the page renders.
    const preview =
      !api && request.method === 'GET' && hasPreview(url.pathname)
        ? previewOf(forwarded, env, url.pathname)
        : Promise.resolve(undefined)
    const response = signInPage(await (api ? env.API : env.WEBSITE).fetch(forwarded), url)
    const page = !api && request.method === 'GET' && hasPreview(url.pathname)
    const secured = withSecurityHeaders(
      page ? withPreview(response, await preview, url) : response,
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
