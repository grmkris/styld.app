import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { chromium } from 'playwright'
import { verifyBrowser } from '../packages/server/test/BrowserAcceptance.ts'
import { csrf } from '../packages/auth/src/config.ts'

const origin = new URL(process.env.STYLD_PREVIEW_URL ?? '')
if (!origin.hostname.startsWith('styldappv2-styldedge-preview-') || !origin.hostname.endsWith('.workers.dev')) {
  throw new Error('Acceptance requires the isolated v2 preview URL')
}

test('deployed preview serves API/auth contracts and the hydrated website', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const health = await context.request.get(new URL('/api/health', origin).toString())
    expect(health.status()).toBe(200)
    expect(await health.json()).toMatchObject({ service: 'styldappv2', status: 'ok' })
    const session = await context.request.post(new URL('/api/auth/getSession', origin).toString(), {
      headers: { origin: origin.origin, [csrf.header]: csrf.value },
      data: {},
    })
    expect(session.status()).toBe(200)
    expect(await session.json()).toMatchObject({ _tag: 'Success' })
    const rejected = await context.request.post(new URL('/api/auth/getSession', origin).toString(), {
      headers: { origin: 'https://evil.invalid', [csrf.header]: csrf.value },
      data: {},
    })
    expect(rejected.status()).toBe(403)
    const missing = await context.request.get(new URL('/api/missing', origin).toString())
    expect(missing.status()).toBe(404)
    await context.close()
    await verifyBrowser(browser, origin.origin)
  } finally {
    await browser.close()
  }
}, 60000)

test('deployed preview offers MCP to OAuth clients: discovery, challenge, registration', async () => {
  const at = (path: string) => new URL(path, origin).toString()
  const resource = await fetch(at('/.well-known/oauth-protected-resource/mcp'))
  expect(resource.status).toBe(200)
  expect(await resource.json()).toMatchObject({
    resource: at('/mcp'),
    authorization_servers: [origin.origin],
    scopes_supported: ['styld'],
  })
  const server = await fetch(at('/.well-known/oauth-authorization-server'))
  expect(server.status).toBe(200)
  expect(await server.json()).toMatchObject({
    issuer: origin.origin,
    registration_endpoint: at('/oauth/mcp/register'),
    code_challenge_methods_supported: ['S256'],
  })
  const challenged = await fetch(at('/mcp'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  expect(challenged.status).toBe(401)
  expect(challenged.headers.get('www-authenticate')).toContain(
    `resource_metadata="${at('/.well-known/oauth-protected-resource/mcp')}"`,
  )
  expect((await fetch(at('/mcp'))).status).toBe(405)
  const register = (redirect: string) =>
    fetch(at('/oauth/mcp/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Styld preview acceptance',
        redirect_uris: [redirect],
        token_endpoint_auth_method: 'none',
      }),
    })
  expect((await register('cursor://anysphere.cursor-retrieval/oauth')).status).toBe(400)
  const registered = await register('http://127.0.0.1:33418/callback')
  expect(registered.status).toBe(201)
  const { client_id: clientId } = Schema.decodeUnknownSync(Schema.Struct({ client_id: Schema.String }))(
    await registered.json(),
  )
  expect(clientId).toMatch(/^dcr_[0-9a-f]{32}$/)
}, 30000)

const onPreview = (path: string) => new URL(path, origin).toString()

test('deployed preview keeps static files for good and asks for its face with the document', async () => {
  const page = await (await fetch(onPreview('/login'))).text()
  const preload = /<link rel="preload" href="([^"]+\.woff2)" as="font" type="font\/woff2" crossorigin>/.exec(page)?.[1]
  const script = /<script type="module" crossorigin src="([^"]+)"/.exec(page)?.[1]
  const anton = /url\(['"]?(\/fonts\/anton-latin\.[0-9a-f]{8}\.woff2)/.exec(
    await (await fetch(onPreview(/<link rel="stylesheet" crossorigin href="([^"]+)"/.exec(page)?.[1] ?? '/'))).text(),
  )?.[1]
  for (const path of [preload, script, anton]) {
    expect(path).toBeDefined()
    const response = await fetch(onPreview(path ?? '/'))
    expect({ path, status: response.status, cache: response.headers.get('cache-control') }).toEqual({
      path,
      status: 200,
      cache: 'public, max-age=31536000, immutable',
    })
  }
})
