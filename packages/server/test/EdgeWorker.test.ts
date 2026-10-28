import { describe, expect, test } from 'vitest'
import edge, { isApiPath } from '../src/EdgeWorker.ts'

describe('public edge routing', () => {
  test.each([
    '/api',
    '/api/auth/getSession',
    '/rpc/test',
    '/mcp',
    '/.well-known/oauth-authorization-server',
    '/cdn/id',
    '/out/id',
  ])('routes the API namespace %s', (path) => expect(isApiPath(path)).toBe(true))
  test.each(['/', '/@name', '/apiary', '/rpc-other', '/mcps', '/.well-known-example', '/outfit', '/cdn-old'])(
    'keeps website path %s on the website',
    (path) => expect(isApiPath(path)).toBe(false),
  )
  test('passes request bodies, cookies, redirects and repeated response headers unchanged', async () => {
    const request = new Request('https://styld.test/api/auth/getSession?x=1', {
      method: 'POST',
      headers: { cookie: 'session=test', origin: 'https://styld.test' },
      body: '{}',
    })
    const headers = new Headers({ location: '/signed-in' })
    headers.append('set-cookie', 'session=one; HttpOnly; Secure')
    headers.append('set-cookie', 'csrf=two; Secure')
    const response = new Response('redirect', { status: 302, headers })
    const api = {
      fetch: async (received: Request) => {
        expect(received).toBe(request)
        expect(await received.text()).toBe('{}')
        expect(received.headers.get('cookie')).toBe('session=test')
        return response
      },
    }
    const website = {
      fetch: async () => {
        throw new Error('Unexpected website request')
      },
    }
    const result = await edge.fetch(request, { API: api, WEBSITE: website })
    expect(result).toBe(response)
    expect(result.headers.getSetCookie()).toHaveLength(2)
    expect(result.status).toBe(302)
  })
})
