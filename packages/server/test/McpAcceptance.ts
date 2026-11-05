import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect } from 'bun:test'
import { Schema } from 'effect'
import { toolNames } from './ToolNames.ts'
import { seedAccounts, signInBody } from './Accounts.ts'
import { csrf } from '@styld/auth/config'
import { ViewImages } from '@styld/protocol'
import { viewsUri } from '../src/mcp/Resources.ts'

/** Test-only acceptance: an MCP client's whole journey through the public edge. */

type Jar = Map<string, string>
type Tokens = { readonly access: string; readonly refresh: string }

const redirectUri = 'http://127.0.0.1:43110/callback'
const Endpoints = Schema.Struct({ authorization_endpoint: Schema.String, token_endpoint: Schema.String })
const Registered = Schema.Struct({ client_id: Schema.String, grant_types: Schema.Array(Schema.String) })
const TokenBody = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
})
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')

const remember = (jar: Jar, response: Response) => {
  for (const header of response.headers.getSetCookie()) {
    const [pair = ''] = header.split(';')
    const separator = pair.indexOf('=')
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}
const cookies = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')

const signIn = async (origin: string, jar: Jar) => {
  const response = await fetch(`${origin}/api/auth/signIn`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', [csrf.header]: csrf.value },
    body: JSON.stringify(signInBody('native-mcp')),
  })
  expect(response.status).toBe(200)
  remember(jar, response)
}

const discover = async (origin: string) => {
  const resource = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`)
  expect(await resource.json()).toMatchObject({ resource: `${origin}/mcp`, authorization_servers: [origin] })
  const server = await fetch(`${origin}/.well-known/oauth-authorization-server`)
  const metadata: unknown = await server.json()
  expect(metadata).toMatchObject({
    issuer: origin,
    registration_endpoint: `${origin}/oauth/mcp/register`,
    code_challenge_methods_supported: ['S256'],
  })
  const unauthenticated = await fetch(`${origin}/mcp`, { method: 'POST', body: '{}' })
  expect(unauthenticated.status).toBe(401)
  expect(unauthenticated.headers.get('www-authenticate')).toBe(
    `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="styld"`,
  )
  expect((await fetch(`${origin}/mcp`)).status).toBe(405)
  return Schema.decodeUnknownSync(Endpoints)(metadata)
}

const register = async (origin: string) => {
  const refused = await fetch(`${origin}/oauth/mcp/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Custom scheme', redirect_uris: ['cursor://anysphere/oauth'] }),
  })
  expect(refused.status).toBe(400)
  const response = await fetch(`${origin}/oauth/mcp/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Native MCP test',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
    }),
  })
  expect(response.status).toBe(201)
  const client = Schema.decodeUnknownSync(Registered)(await response.json())
  expect(client.grant_types).toEqual(['authorization_code', 'refresh_token'])
  return client.client_id
}

/** Follow the server's own redirects (the pending authorization moves into a private cookie). */
const follow = async (start: URL, jar: Jar) => {
  let response = await fetch(start, { headers: { cookie: cookies(jar) }, redirect: 'manual' })
  remember(jar, response)
  for (let hops = 0; hops < 3 && [302, 303].includes(response.status); hops++) {
    const next = new URL(response.headers.get('location') ?? '/', start)
    if (next.origin !== start.origin || next.pathname !== start.pathname) return response
    response = await fetch(next, { headers: { cookie: cookies(jar) }, redirect: 'manual' })
    remember(jar, response)
  }
  return response
}

/** Authorization code with PKCE: the login redirect, consent and the code exchange. */
const authorize = async (
  origin: string,
  jar: Jar,
  endpoints: Awaited<ReturnType<typeof discover>>,
  clientId: string,
) => {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const url = new URL(endpoints.authorization_endpoint)
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'styld',
    state: 'native-state',
    resource: `${origin}/mcp`,
  }))
    url.searchParams.set(key, value)
  const consent = await follow(url, jar)
  const page = await consent.text()
  expect(consent.status, page.slice(0, 200)).toBe(200)
  expect(consent.headers.get('content-security-policy')).toContain('form-action')
  const action = /action="([^"]+)"/.exec(page)?.[1]?.replaceAll('&amp;', '&') ?? ''
  const consentCsrf = /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? ''
  const approved = await fetch(new URL(action, origin), {
    method: 'POST',
    headers: { cookie: cookies(jar), origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: consentCsrf, decision: 'approve' }),
    redirect: 'manual',
  })
  remember(jar, approved)
  const location = new URL(approved.headers.get('location') ?? 'http://invalid/')
  expect(`${location.origin}${location.pathname}`).toBe(redirectUri)
  expect(location.searchParams.get('state')).toBe('native-state')
  return exchange(endpoints, clientId, {
    grant_type: 'authorization_code',
    code: location.searchParams.get('code') ?? '',
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: `${origin}/mcp`,
  })
}

const exchange = async (
  endpoints: { readonly token_endpoint: string },
  clientId: string,
  form: Record<string, string>,
) => {
  const response = await fetch(endpoints.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, client_id: clientId }),
  })
  const body = Schema.decodeUnknownSync(TokenBody)(await response.json())
  return { status: response.status, tokens: { access: body.access_token ?? '', refresh: body.refresh_token ?? '' } }
}

/** The pictures a view result carries for the view alone, in its `_meta`. */
const viewImagesOf = (result: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ _meta: Schema.Struct({ 'styld/images': ViewImages }) }))(result)['_meta'][
    'styld/images'
  ]

/** The 2026-07-28 client (SDK 2.x) and an initialize-era client (SDK 1.x) both see and call the tools. */
const useTools = async (origin: string, access: string) => {
  const requestInit = { headers: { authorization: `Bearer ${access}` } }
  const modern = new Client({ name: 'styld-native-modern', version: '1.0.0' })
  await modern.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit }))
  const legacy = new LegacyClient({ name: 'styld-native-legacy', version: '1.0.0' })
  await legacy.connect(new LegacyTransport(new URL(`${origin}/mcp`), { requestInit }))
  for (const client of [modern, legacy]) {
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([...toolNames])
    // Hosts read the view from the resource the tool names, through either protocol era.
    const view = (await client.readResource({ uri: viewsUri })).contents[0]
    expect(view).toMatchObject({ uri: viewsUri, mimeType: 'text/html;profile=mcp-app' })
    expect(view !== undefined && 'text' in view ? view.text : '').toContain('<div id="styld-view"></div>')
    const result = await client.callTool({ name: 'account_get', arguments: {} })
    expect(result.structuredContent).toEqual({
      accountId: 'native-mcp',
      displayName: 'Native Identity',
      email: 'native-mcp@example.invalid',
      url: `${origin}/account`,
    })
  }
  await addPieceThroughTools(origin, modern)
  await modern.close()
  await legacy.close()
}

/** A 1x1 PNG, the smallest photo the upload checks accept. */
const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
)

const Structured = Schema.Struct({ structuredContent: Schema.Record(Schema.String, Schema.Unknown) })
const structured = async (client: Client, name: string, args: Record<string, unknown>) =>
  Schema.decodeUnknownSync(Structured)(await client.callTool({ name, arguments: args })).structuredContent

/** An assistant uploads a photo, adds it, finds it, changes it and deletes it: the same wardrobe
 * operations the website uses, acting for the token's account. */
const addPieceThroughTools = async (origin: string, client: Client) => {
  const upload = Schema.decodeUnknownSync(Schema.Struct({ uploadId: Schema.String, uploadUrl: Schema.String }))(
    await structured(client, 'upload_create', {
      operationId: 'mcp-native-upload-1',
      contentType: 'image/png',
      bytes: png.byteLength,
    }),
  )
  expect(upload.uploadUrl.startsWith(`${origin}/api/uploads/`)).toBe(true)
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: new Blob([png]),
  })
  expect(put.status).toBe(204)
  const add = {
    operationId: 'mcp-native-add-1',
    uploadId: upload.uploadId,
    type: 'trainers',
    name: 'White trainers',
  }
  const added = await structured(client, 'piece_add', add)
  expect(added).toMatchObject({ name: 'White trainers', source: 'assistant', status: 'processing' })
  const pieceId = Schema.decodeUnknownSync(Schema.String)(added['id'])
  expect(added['url']).toBe(`${origin}/wardrobe/${pieceId}`)
  // The same operation id returns the same piece instead of adding a second one.
  expect(await structured(client, 'piece_add', add)).toMatchObject({ id: pieceId })
  // The search finds only ready pieces, as the website's does, by its type's words in either language.
  let status = added['status']
  for (let attempt = 0; attempt < 100 && status === 'processing'; attempt += 1) {
    await Bun.sleep(100)
    status = (await structured(client, 'piece_get', { pieceId }))['status']
  }
  expect(status).toBe('ready')
  for (const q of ['trainers', 'superge'])
    expect(await structured(client, 'piece_search', { q })).toMatchObject({
      pieces: [{ id: pieceId }],
      nextCursor: null,
    })
  expect(
    await structured(client, 'piece_update', { pieceId, operationId: 'mcp-native-update-1', colours: ['white'] }),
  ).toMatchObject({
    colours: ['white'],
  })
  const lookId = await lookThroughTools(origin, client, pieceId)
  await boardThroughTools(origin, client, pieceId, lookId)
  expect(await structured(client, 'piece_delete', { pieceId, operationId: 'mcp-native-delete-1' })).toEqual({
    deleted: true,
    pieceId,
  })
  const gone = await client.callTool({ name: 'piece_get', arguments: { pieceId } })
  expect(gone.isError).toBe(true)
  // Several at once: a piece already deleted is skipped, since gone is what was asked for.
  expect(
    await structured(client, 'pieces_delete', { pieceIds: [pieceId], operationId: 'mcp-native-deletes-1' }),
  ).toEqual({ deleted: true, pieceIds: [pieceId] })
  // A deleted piece leaves its looks; deleting the look leaves nothing behind.
  expect(await structured(client, 'look_get', { lookId })).toMatchObject({ id: lookId, pieces: [] })
  expect(await structured(client, 'look_delete', { lookId, operationId: 'mcp-native-look-delete-1' })).toEqual({
    deleted: true,
    lookId,
  })
  expect((await client.callTool({ name: 'look_get', arguments: { lookId } })).isError).toBe(true)
}

/** An assistant puts a look together from the piece, once per operation id, and only from this
 * wardrobe's pieces. Returns the look's id. */
const lookThroughTools = async (origin: string, client: Client, pieceId: string) => {
  const create = { operationId: 'mcp-native-look-1', name: 'Weekend', occasion: 'Brunch', pieceIds: [pieceId] }
  const look = await structured(client, 'look_create', create)
  expect(look).toMatchObject({ name: 'Weekend', occasion: 'Brunch', pieces: [{ id: pieceId }] })
  const lookId = Schema.decodeUnknownSync(Schema.String)(look['id'])
  expect(look['url']).toBe(`${origin}/looks/${lookId}`)
  expect(await structured(client, 'look_create', create)).toMatchObject({ id: lookId })
  expect((await client.callTool({ name: 'look_create', arguments: { ...create, name: 'Other' } })).isError).toBe(true)
  const stranger = { operationId: 'mcp-native-look-2', name: 'Not mine', pieceIds: [`pc_${'a'.repeat(22)}`] }
  expect((await client.callTool({ name: 'look_create', arguments: stranger })).isError).toBe(true)
  expect(await structured(client, 'look_list', {})).toMatchObject({ looks: [{ id: lookId }] })
  return lookId
}

/** An assistant makes a board: starts it once per operation id, pins the piece and the look, lays the collage out
 * as an outfit with a headline, sets it exactly from the version it read (a stale version is refused), shows it in
 * the Styld view and finds it in the list. */
const boardThroughTools = async (origin: string, client: Client, pieceId: string, lookId: string) => {
  const create = { operationId: 'mcp-native-board-1', name: 'Brunch' }
  const board = await structured(client, 'board_create', create)
  const boardId = Schema.decodeUnknownSync(Schema.String)(board['id'])
  expect(board).toMatchObject({ name: 'Brunch', version: 0, pins: [], table: [], url: `${origin}/boards/${boardId}` })
  expect(await structured(client, 'board_create', create)).toMatchObject({ id: boardId })
  const pin = { boardId, operationId: 'mcp-native-pin-1', pieceIds: [pieceId], lookIds: [lookId] }
  expect(await structured(client, 'pin_add', pin)).toMatchObject({
    version: 0,
    pins: [
      { kind: 'piece', piece: { id: pieceId } },
      { kind: 'look', look: { id: lookId, pieceIds: [pieceId] } },
    ],
  })
  const arrange = {
    boardId,
    operationId: 'mcp-native-arrange-1',
    layout: 'outfit',
    add: [
      { _tag: 'TablePiece', pieceId },
      { _tag: 'TableLabel', text: 'Brunch', style: 'headline' },
    ],
  }
  const arranged = await structured(client, 'collage_arrange', arrange)
  expect(arranged).toMatchObject({
    version: 1,
    table: [
      { pieceId, x: 290, y: 320 },
      { text: 'Brunch', x: 500 },
    ],
  })
  expect(await structured(client, 'collage_arrange', arrange)).toMatchObject({ version: 1 })
  const stale = { boardId, operationId: 'mcp-native-set-1', version: 0, items: [] }
  expect((await client.callTool({ name: 'collage_set', arguments: stale })).isError).toBe(true)
  const exact = {
    boardId,
    operationId: 'mcp-native-set-2',
    version: 1,
    items: [{ thing: { _tag: 'TablePiece', pieceId }, x: 500, y: 600, size: 500 }],
  }
  expect(await structured(client, 'collage_set', exact)).toMatchObject({
    version: 2,
    table: [{ pieceId, x: 500, y: 600, size: 500, turn: 0 }],
  })
  const shown = await client.callTool({ name: 'board_show', arguments: { boardId } })
  expect(shown.structuredContent).toMatchObject({
    _tag: 'BoardView',
    name: 'Brunch',
    url: `${origin}/boards/${boardId}`,
  })
  expect(await structured(client, 'board_list', {})).toMatchObject({
    boards: [{ id: boardId, pinCount: 2, onTable: 1 }],
  })
  // The media views read through the services' own contexts: their pictures still reach `_meta`, never the model.
  const piecesShown = await client.callTool({ name: 'pieces_show', arguments: { pieceIds: [pieceId] } })
  expect(piecesShown.structuredContent).toMatchObject({ _tag: 'PiecesView', rows: [[{ id: pieceId }]] })
  expect(Object.keys(viewImagesOf(piecesShown))).toEqual([pieceId])
  expect(JSON.stringify(piecesShown.structuredContent)).not.toContain('data:')
  const pieceShown = await client.callTool({ name: 'piece_show', arguments: { pieceId } })
  expect(pieceShown.structuredContent).toMatchObject({ _tag: 'PieceView', piece: { id: pieceId } })
  expect(Object.keys(viewImagesOf(pieceShown)).length).toBeGreaterThan(0)
  const gallery = await client.callTool({ name: 'gallery_show', arguments: {} })
  expect(gallery.structuredContent).toMatchObject({ _tag: 'GalleryView', photos: [] })
}

const mcpStatus = async (origin: string, access: string) =>
  (
    await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
  ).status

/** Refresh rotates; replaying a used refresh token ends the whole grant. */
const rotate = async (
  origin: string,
  endpoints: { readonly token_endpoint: string },
  clientId: string,
  tokens: Tokens,
) => {
  const refresh = { grant_type: 'refresh_token', resource: `${origin}/mcp` }
  const rotated = await exchange(endpoints, clientId, { ...refresh, refresh_token: tokens.refresh })
  expect(rotated.status).toBe(200)
  expect(rotated.tokens.refresh).not.toBe(tokens.refresh)
  expect(await mcpStatus(origin, rotated.tokens.access)).toBe(200)
  const replayed = await exchange(endpoints, clientId, { ...refresh, refresh_token: tokens.refresh })
  expect(replayed.status).toBe(400)
  expect(await mcpStatus(origin, rotated.tokens.access)).toBe(401)
}

export const verifyMcp = async (origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, 'native-mcp')
  const endpoints = await discover(origin)
  const clientId = await register(origin)
  const jar: Jar = new Map()
  // Without a session the authorization request goes to the sign-in page first.
  const anonymous = await follow(
    new URL(
      `${endpoints.authorization_endpoint}?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256&scope=styld&resource=${encodeURIComponent(`${origin}/mcp`)}`,
    ),
    new Map(),
  )
  expect(new URL(anonymous.headers.get('location') ?? 'http://invalid/', origin).pathname).toBe('/login/connect')
  await signIn(origin, jar)
  const first = await authorize(origin, jar, endpoints, clientId)
  expect(first.status).toBe(200)
  await useTools(origin, first.tokens.access)
  await rotate(origin, endpoints, clientId, first.tokens)
  const second = await authorize(origin, jar, endpoints, clientId)
  const revoked = await fetch(`${origin}/oauth/mcp/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: second.tokens.access, client_id: clientId }),
  })
  expect(revoked.status).toBe(200)
  expect(await mcpStatus(origin, second.tokens.access)).toBe(401)
  const third = await authorize(origin, jar, endpoints, clientId)
  expect(await mcpStatus(origin, third.tokens.access)).toBe(200)
  expect((await fetch(`${fixtures}/test/identity/disable-mcp`, { method: 'POST' })).status).toBe(204)
  expect(await mcpStatus(origin, third.tokens.access)).toBe(401)
}
