// The measurement account as an MCP client on the deployed stage: it registers once, approves itself with the
// browser session's cookie (authorization code with PKCE), and calls tools with a bearer token over the sessionless
// protocol. Tokens stay in memory.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Schema } from 'effect'
import { type BrowserContext } from 'playwright'

const redirectUri = 'http://127.0.0.1:43111/callback'
const Endpoints = Schema.Struct({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.String,
})
const Registered = Schema.Struct({ client_id: Schema.String })
const Tokens = Schema.Struct({ access_token: Schema.String })

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')

const json = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (!response.ok)
    throw new Error(`${new URL(response.url).pathname} answered ${response.status}: ${text.slice(0, 200)}`)
  const parsed: unknown = JSON.parse(text)
  return parsed
}

/** A bearer token for the account behind the context's session. */
const accessToken = async (origin: string, context: BrowserContext): Promise<string> => {
  const endpoints = Schema.decodeUnknownSync(Endpoints)(
    await json(await fetch(`${origin}/.well-known/oauth-authorization-server`)),
  )
  const { client_id: clientId } = Schema.decodeUnknownSync(Registered)(
    await json(
      await fetch(endpoints.registration_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Styld measurement',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
        }),
      }),
    ),
  )
  // PKCE: the verifier stays here, its SHA-256 goes in the authorization request.
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const url = new URL(endpoints.authorization_endpoint)
  url.search = new URLSearchParams([
    ['response_type', 'code'],
    ['client_id', clientId],
    ['redirect_uri', redirectUri],
    ['code_challenge', base64url(new Uint8Array(digest))],
    ['code_challenge_method', 'S256'],
    ['scope', 'styld'],
    ['state', 'measure'],
    ['resource', `${origin}/mcp`],
  ]).toString()
  // The session's cookies carry the approval: follow the server's own redirects to the consent page, then approve.
  const jar = new Map((await context.cookies(origin)).map(({ name, value }) => [name, value]))
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  const remember = (response: Response) => {
    for (const header of response.headers.getSetCookie()) {
      const [pair = ''] = header.split(';')
      const separator = pair.indexOf('=')
      if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }
  let consent = await fetch(url, { headers: { cookie: cookie() }, redirect: 'manual' })
  remember(consent)
  for (let hops = 0; hops < 3 && [302, 303].includes(consent.status); hops += 1) {
    consent = await fetch(new URL(consent.headers.get('location') ?? '/', url), {
      headers: { cookie: cookie() },
      redirect: 'manual',
    })
    remember(consent)
  }
  const form = await consent.text()
  const action = /action="([^"]+)"/u.exec(form)?.[1]?.replaceAll('&amp;', '&') ?? ''
  const csrfValue = /name="csrf" value="([^"]+)"/u.exec(form)?.[1] ?? ''
  if (action === '') throw new Error(`no consent form (${consent.status})`)
  const approved = await fetch(new URL(action, origin), {
    method: 'POST',
    headers: { cookie: cookie(), origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: csrfValue, decision: 'approve' }),
    redirect: 'manual',
  })
  const code = new URL(approved.headers.get('location') ?? 'http://invalid/').searchParams.get('code') ?? ''
  if (code === '') throw new Error(`the consent gave no code (${approved.status})`)
  const tokens = Schema.decodeUnknownSync(Tokens)(
    await json(
      await fetch(endpoints.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
          resource: `${origin}/mcp`,
          client_id: clientId,
        }),
      }),
    ),
  )
  return tokens.access_token
}

export interface McpSession {
  readonly call: (name: string, input: Record<string, unknown>) => Promise<unknown>
  readonly close: () => Promise<void>
}

/** A connected MCP client acting as the context's account. */
export const mcpSession = async (origin: string, context: BrowserContext): Promise<McpSession> => {
  const token = await accessToken(origin, context)
  const client = new Client({ name: 'styld-measure', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  return {
    call: async (name, input) => client.callTool({ name, arguments: input }),
    close: async () => client.close(),
  }
}
