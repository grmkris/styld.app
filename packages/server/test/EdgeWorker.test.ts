import { describe, expect, test } from 'vitest'
import { apiPolicy, documentPolicy } from '../src/EdgeSecurity.ts'
import edge, { isApiPath } from '../src/EdgeWorker.ts'

describe('public edge routing', () => {
  test.each([
    '/api',
    '/api/auth/getSession',
    '/mcp',
    '/oauth/mcp/token',
    '/.well-known/oauth-authorization-server',
    '/cdn/id',
  ])('routes the API namespace %s', (path) => expect(isApiPath(path)).toBe(true))
  test.each([
    '/',
    // The API serves nothing under /rpc or /out.
    '/rpc/test',
    '/out/id',
    '/@name',
    '/apiary',
    '/rpc-other',
    '/mcps',
    '/oauthx',
    '/.well-known-example',
    '/outfit',
    '/cdn-old',
  ])('keeps website path %s on the website', (path) => expect(isApiPath(path)).toBe(false))
  test('passes request bodies, cookies, redirects and repeated response headers unchanged', async () => {
    const request = new Request('https://styld.test/api/auth/getSession?x=1', {
      method: 'POST',
      headers: {
        cookie: 'session=test',
        origin: 'https://styld.test',
        'x-styld-correlation-id': 'caller-controlled-secret',
        'x-styld-job-id': 'caller-controlled-secret',
        'x-styld-kind': 'caller-controlled-secret',
      },
      body: '{}',
    })
    const headers = new Headers({ location: '/signed-in' })
    headers.append('set-cookie', 'session=one; HttpOnly; Secure')
    headers.append('set-cookie', 'csrf=two; Secure')
    const response = new Response('redirect', { status: 302, headers })
    let forwardedCorrelation: string | null = null
    const api = {
      fetch: async (received: Request) => {
        forwardedCorrelation = received.headers.get('x-styld-correlation-id')
        expect(received.url).toBe(request.url)
        expect(received.method).toBe(request.method)
        expect(await received.text()).toBe('{}')
        expect(received.headers.get('cookie')).toBe('session=test')
        expect(received.headers.get('origin')).toBe('https://styld.test')
        expect(received.headers.get('x-styld-correlation-id')).toMatch(/^[0-9a-f-]{36}$/)
        expect(received.headers.has('x-styld-job-id')).toBe(false)
        expect(received.headers.has('x-styld-kind')).toBe(false)
        return response
      },
    }
    const website = {
      fetch: async () => {
        throw new Error('Unexpected website request')
      },
    }
    const result = await edge.fetch(request, { API: api, WEBSITE: website })
    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBe('/signed-in')
    expect(result.headers.getSetCookie()).toEqual(['session=one; HttpOnly; Secure', 'csrf=two; Secure'])
    expect(await result.text()).toBe('redirect')
    expect(result.headers.get('content-security-policy')).toBe(apiPolicy)
    // The answer names the id its logs carry, never one the caller chose.
    expect(result.headers.get('x-styld-correlation-id')).toBe(forwardedCorrelation)
    expect(result.headers.get('x-styld-correlation-id')).not.toBe('caller-controlled-secret')
  })

  test('secures website documents against framing and foreign scripts', async () => {
    const page = new Response('<!doctype html>', {
      status: 404,
      headers: { 'content-type': 'text/html', 'cache-control': 'private, no-store' },
    })
    const result = await edge.fetch(new Request('https://styld.test/missing'), {
      API: {
        fetch: async () => {
          throw new Error('Unexpected API request')
        },
      },
      WEBSITE: { fetch: async () => page },
    })
    expect(result.status).toBe(404)
    expect(await result.text()).toBe('<!doctype html>')
    expect(Object.fromEntries(result.headers)).toMatchObject({
      'cache-control': 'private, no-store',
      'content-security-policy': documentPolicy,
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'strict-transport-security': 'max-age=31536000',
    })
    expect(documentPolicy).toContain("frame-ancestors 'none'")
    expect(documentPolicy).toContain("script-src 'self'")
  })

  test('keeps the policy the API sets for a document it renders, and only for the API', async () => {
    const consentPolicy = "default-src 'none'; form-action 'self' http://127.0.0.1:43110; frame-ancestors 'none'"
    const rendered = () =>
      new Response('<form>', { headers: { 'content-type': 'text/html', 'content-security-policy': consentPolicy } })
    const fromApi = await edge.fetch(new Request('https://styld.test/oauth/mcp/authorize'), {
      API: { fetch: async () => rendered() },
      WEBSITE: { fetch: async () => new Response('unused') },
    })
    expect(fromApi.headers.get('content-security-policy')).toBe(consentPolicy)
    expect(fromApi.headers.get('x-frame-options')).toBe('DENY')
    // A website response cannot loosen the document policy by setting its own.
    const fromWebsite = await edge.fetch(new Request('https://styld.test/'), {
      API: { fetch: async () => new Response('unused') },
      WEBSITE: { fetch: async () => rendered() },
    })
    expect(fromWebsite.headers.get('content-security-policy')).toBe(documentPolicy)
  })

  test('keeps a preview deployment out of search engines', async () => {
    const unused = { fetch: async () => new Response('unused') }
    const page = await edge.fetch(new Request('https://styld.test/'), {
      API: unused,
      WEBSITE: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
      ROBOTS: 'noindex',
    })
    expect(page.headers.get('x-robots-tag')).toBe('noindex')
  })

  test('reads a public page’s preview from the API Worker while the page renders, in the reader’s language and as the reader', async () => {
    const asked: Array<{ readonly url: string; readonly language: string | null; readonly cookie: string | null }> = []
    const api = {
      fetch: async (request: Request) => {
        asked.push({
          url: request.url,
          language: request.headers.get('accept-language'),
          cookie: request.headers.get('cookie'),
        })
        return Response.json({ title: 'Nika on Styld', description: 'Boards', image: null })
      },
    }
    const page = await edge.fetch(
      new Request('https://styld.test/@nika.kovac', {
        headers: { 'accept-language': 'sl', cookie: 'styld_session=reader' },
      }),
      {
        API: api,
        WEBSITE: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
      },
    )
    expect(page.status).toBe(200)
    expect(asked).toEqual([
      {
        url: 'https://styld.test/api/public/meta?path=%2F%40nika.kovac',
        language: 'sl',
        cookie: 'styld_session=reader',
      },
    ])
  })
})

/** A page the website served, naming what the edge should count. */
const page = (count: string) =>
  new Response('<html></html>', { headers: { 'content-type': 'text/html', 'x-styld-count': count } })

/** A deployment whose dataset keeps what it is given. */
const deployment = (points: Array<unknown>) => ({
  API: {
    fetch: async () => new Response(null, { status: 404, headers: { 'x-styld-count': 'landing.shown.coat' } }),
  },
  WEBSITE: { fetch: async () => page('landing.shown.coat') },
  METRICS: { writeDataPoint: (point: unknown) => void points.push(point) },
  STYLD_ENV: 'preview',
  STYLD_RELEASE: 'r1',
})

describe('the landing count', () => {
  test('a landing the website served is counted by its hero, and the header never reaches the browser', async () => {
    const points: Array<unknown> = []
    const response = await edge.fetch(new Request('https://styld.test/'), deployment(points))
    expect(response.headers.get('x-styld-count')).toBeNull()
    expect(points).toEqual([
      { indexes: ['landing.shown.coat'], blobs: ['preview', 'r1', 'landing.shown', 'coat'], doubles: [1] },
    ])
  })

  test('the API cannot ask for a count, and a name outside the list is dropped', async () => {
    const points: Array<unknown> = []
    const fromApi = await edge.fetch(new Request('https://styld.test/cdn/landing/x'), deployment(points))
    expect(fromApi.headers.get('x-styld-count')).toBeNull()
    const odd = await edge.fetch(new Request('https://styld.test/'), {
      ...deployment(points),
      WEBSITE: { fetch: async () => page('signup.person@example.com') },
    })
    expect(odd.headers.get('x-styld-count')).toBeNull()
    expect(points).toEqual([])
  })

  test('a deployment without the dataset serves the page and counts nothing', async () => {
    const { METRICS: _, ...bare } = deployment([])
    const response = await edge.fetch(new Request('https://styld.test/'), bare)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-styld-count')).toBeNull()
  })
})
