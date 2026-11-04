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
  /** The Analytics Engine dataset the landing's heroes are counted in (`kernel/Metrics.ts`), with the deployment it
   * names; without it nothing is counted. */
  readonly METRICS?: {
    writeDataPoint(point: {
      readonly indexes: Array<string>
      readonly blobs: Array<string>
      readonly doubles: Array<number>
    }): void
  }
  readonly STYLD_ENV?: string
  readonly STYLD_RELEASE?: string
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

/** What the website asks the edge to count (`apps/web/src/server/LandingHero.ts` › countHeader): a signed-out Home
 * shown, or a sign-in begun, by the hero the visitor got. Never an account, an address or a person. */
const countHeader = 'x-styld-count'
const countable = /^(landing\.shown|signin\.started)\.(mirror|coat|wardrobe)$/

/** Count what the website named and take the header off, so it never reaches the browser. Index `<event>.<hero>`,
 * blobs (environment, release, event, hero), one double. A dataset that refuses the point never fails the page. */
const countLanding = (response: Response, env: EdgeEnvironment, fromWebsite: boolean): void => {
  const named = response.headers.get(countHeader)
  if (named === null) return
  response.headers.delete(countHeader)
  const match = fromWebsite ? countable.exec(named) : null
  if (match === null || env.METRICS === undefined) return
  const [, event = '', hero = ''] = match
  try {
    env.METRICS.writeDataPoint({
      indexes: [named],
      blobs: [env.STYLD_ENV ?? 'unknown', env.STYLD_RELEASE ?? 'unknown', event, hero],
      doubles: [1],
    })
  } catch {
    // Counting is best effort.
  }
}

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
    const secured = withSecurityHeaders(
      withPreview(response, await preview, url),
      api ? apiPolicy : documentPolicy,
      api,
    )
    if (secured.status === 101) return secured
    countLanding(secured, env, !api)
    if (env.ROBOTS === 'noindex') secured.headers.set('x-robots-tag', 'noindex')
    // The id the logs of this request carry, so a person reporting a problem can quote it.
    secured.headers.set('x-styld-correlation-id', correlationId)
    return secured
  },
}
